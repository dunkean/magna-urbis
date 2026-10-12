use catalogue::{Envelope, VerticalAccess};
use geometry::{area, bounds, difference, ellipse, intersection, rectangle, union};
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
fn project(unit: &HouseUnit, group: &str) -> Surface {
    unit.roofs
        .faces
        .iter()
        .filter(|f| {
            f.roof_group == group
                && matches!(
                    f.kind,
                    RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
                )
        })
        .fold(vec![], |surface, face| {
            union(
                &surface,
                &vec![Polygon {
                    outer: face
                        .vertices
                        .iter()
                        .map(|&i| {
                            let v = &unit.roofs.vertices[i as usize];
                            Point { x: v.x, y: v.y }
                        })
                        .collect(),
                    holes: vec![],
                }],
            )
        })
}

fn corbel_fixture(profile: CorbelProfile) -> HouseUnit {
    let mut unit = fixture(if profile == CorbelProfile::Dome {
        "RF-DOME"
    } else {
        "RF-FLAT"
    });
    let footprint = if profile == CorbelProfile::Dome {
        ellipse(6.0, 4.0, 3.0, 3.0, 64)
    } else {
        rectangle(0.0, 0.0, 10.0, 5.0)
    };
    let material = if profile == CorbelProfile::Dome {
        "MAT-STONE-DRY"
    } else {
        "MAT-STONE-MORTAR"
    };
    let thickness = if profile == CorbelProfile::Dome {
        0.5
    } else {
        1.5
    };
    let floor = geometry::offset(&footprint, -thickness);
    let height = if profile == CorbelProfile::Dome {
        3.0
    } else {
        4.6
    };
    unit.bodies[0].footprint = footprint.clone();
    unit.bodies[0].wall_thickness_m = thickness;
    unit.bodies[0].roof_spec.parapet_height_m = 0.0;
    unit.bodies[0].roof_spec.corbel = Some(CorbelSpec {
        profile,
        courses: if profile == CorbelProfile::Dome {
            32
        } else {
            10
        },
        rise_m: if profile == CorbelProfile::Dome {
            3.2
        } else {
            1.6
        },
        cap_span_m: 0.8,
        cap_thickness_m: 0.25,
        min_bearing_m: 0.1,
        material: material.into(),
    });
    let l = &mut unit.bodies[0].levels[0];
    l.footprint = footprint.clone();
    l.floor = floor.clone();
    l.height_m = height;
    l.materials.frame = material.into();
    l.materials.infill = material.into();
    l.materials.roof_frame = material.into();
    if profile == CorbelProfile::Barrel {
        l.roof_slab = Some(RoofSlab {
            surface: footprint.clone(),
            z_m: height,
            walkable: true,
            access_node: Some("terrace".into()),
        });
        unit.rooms.push(Room {
            id: "room".into(),
            body_id: "main".into(),
            level: 0,
            z_m: 0.0,
            floor: floor.clone(),
            usage: RoomUsage::Living,
            access_node: "room-node".into(),
            household_id: None,
        });
    }
    unit.partition.occupied = footprint.clone();
    unit.levels[0].z_max = height;
    unit.walls.push(Wall {
        solid: None,
        plan_section: None,
        shell_reference: false,
        id: "bearing".into(),
        kind: WallKind::Exterior,
        body_id: Some("main".into()),
        level: 0,
        z_m: 0.0,
        height_m: height,
        footprint: difference(&footprint, &floor),
        centerline: footprint[0].outer.clone(),
        material: material.into(),
        party: false,
        opening_ids: vec![],
    });
    unit
}

fn ogival_fixture(ribs: bool) -> HouseUnit {
    let mut unit = fixture("RF-SHELL");
    let domain = ellipse(6.0, 4.0, 3.0, 3.0, 64);
    let body = &mut unit.bodies[0];
    body.footprint = domain.clone();
    body.levels[0].footprint = domain.clone();
    body.levels[0].floor = domain.clone();
    body.roof_arms = vec![RoofArm {
        domain: domain.clone(),
        ..arm(3.0, 1.0, 6.0, 6.0)
    }];
    body.roof_spec.shell_cross_rise_ratio = 1.2;
    body.roof_spec.shell = Some(ShellSpec {
        profile: ShellProfile::Ogival,
        rib_width_m: if ribs { 0.15 } else { 0.0 },
        rib_depth_m: if ribs { 0.1 } else { 0.0 },
        rib_spacing_m: if ribs { 1.5 } else { 0.0 },
        material: "MAT-COB".into(),
    });
    let mats = &mut body.levels[0].materials;
    mats.frame = "MAT-COB".into();
    mats.infill = "MAT-COB".into();
    mats.cladding = "MAT-COB".into();
    mats.roof_frame = "MAT-COB".into();
    unit.partition.occupied = domain;
    unit
}

fn non_ground_open_edges(unit: &HouseUnit) -> Vec<(u32, u32, usize)> {
    let mut edges = std::collections::BTreeMap::<_, usize>::new();
    for f in &unit.roofs.faces {
        for (&a, &b) in f
            .vertices
            .iter()
            .zip(f.vertices.iter().cycle().skip(1))
            .take(f.vertices.len())
        {
            *edges.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    edges
        .into_iter()
        .filter_map(|((a, b), count)| {
            let va = &unit.roofs.vertices[a as usize];
            let vb = &unit.roofs.vertices[b as usize];
            (count != 2 && va.z.max(vb.z) > 0.001).then_some((a, b, count))
        })
        .collect()
}

fn ray_face_distance(
    unit: &HouseUnit,
    face: &RoofFace,
    origin: [f64; 3],
    direction: [f64; 3],
) -> f64 {
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let dot = |a: [f64; 3], b: [f64; 3]| a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>();
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let vertex = |i: u32| {
        let v = &unit.roofs.vertices[i as usize];
        [v.x, v.y, v.z]
    };
    let a = vertex(face.vertices[0]);
    let mut nearest = f64::INFINITY;
    for i in 1..face.vertices.len() - 1 {
        let ab = sub(vertex(face.vertices[i]), a);
        let ac = sub(vertex(face.vertices[i + 1]), a);
        let h = cross(direction, ac);
        let den = dot(ab, h);
        if den.abs() < 1e-12 {
            continue;
        }
        let s = sub(origin, a);
        let u = dot(s, h) / den;
        let q = cross(s, ab);
        let v = dot(direction, q) / den;
        let t = dot(ac, q) / den;
        if u >= -1e-8 && v >= -1e-8 && u + v <= 1.0 + 1e-8 && t > 1e-8 {
            nearest = nearest.min(t);
        }
    }
    nearest
}

#[test]
fn ogival_shell_is_pointed_thick_and_closed_with_physical_ribs() {
    for ribs in [false, true] {
        let mut unit = ogival_fixture(ribs);
        build_roofs(&mut unit).unwrap();
        let invalid = non_ground_open_edges(&unit);
        assert!(
            invalid.is_empty(),
            "{ribs}: first open edges {:?}",
            &invalid[..invalid.len().min(10)]
        );
        let outer: Vec<_> = unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::ShellOuter)
            .collect();
        let inner: Vec<_> = unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::ShellInner)
            .collect();
        assert!(!outer.is_empty() && !inner.is_empty());
        assert!(outer.iter().all(|f| f.normal[2] > 0.0));
        assert!(inner.iter().all(|f| f.normal[2] < 0.0));
        let peak = unit.roofs.vertices.iter().map(|v| v.z).fold(0.0, f64::max);
        assert!((peak - 7.2).abs() < 0.001);
        let shell_ribs = unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::ShellRib)
            .count();
        assert_eq!(shell_ribs > 0, ribs);
        assert_eq!(
            unit.roofs
                .faces
                .iter()
                .any(|f| f.kind == RoofFaceKind::ShellRibEnd),
            ribs
        );
        // Every meridian has a true inward skin, including at the base; upper
        // skins stay separate and retain at least the declared cap thickness.
        let inner_peak = inner
            .iter()
            .flat_map(|f| &f.vertices)
            .map(|i| unit.roofs.vertices[*i as usize].z)
            .fold(0.0, f64::max);
        assert!(peak - inner_peak >= 0.3 - 0.001);
        if !ribs {
            let mut minimum = f64::INFINITY;
            for face in &inner {
                let n = face.vertices.len() as f64;
                let center = [
                    face.vertices
                        .iter()
                        .map(|i| unit.roofs.vertices[*i as usize].x)
                        .sum::<f64>()
                        / n,
                    face.vertices
                        .iter()
                        .map(|i| unit.roofs.vertices[*i as usize].y)
                        .sum::<f64>()
                        / n,
                    face.vertices
                        .iter()
                        .map(|i| unit.roofs.vertices[*i as usize].z)
                        .sum::<f64>()
                        / n,
                ];
                let direction = face.normal.map(|x| -x);
                let distance = outer
                    .iter()
                    .map(|f| ray_face_distance(&unit, f, center, direction))
                    .fold(f64::INFINITY, f64::min);
                assert!(distance.is_finite());
                minimum = minimum.min(distance);
            }
            assert!(
                minimum >= 0.3 - 0.001,
                "épaisseur normale minimale {minimum:.6}"
            );
        }
        let before = unit.roofs.clone();
        build_roofs(&mut unit).unwrap();
        assert_eq!(before, unit.roofs);
    }
}

#[test]
fn ogival_low_trapezoid_passage_has_real_jambs_and_lintel() {
    let mut unit = ogival_fixture(true);
    unit.access.portals.push(Portal {
        id: "low-door".into(),
        kind: PortalKind::Door,
        from: "outside".into(),
        to: "inside".into(),
        opening: [Point { x: 8.98, y: 3.4 }, Point { x: 8.98, y: 4.6 }],
        wall_id: None,
        feature_ids: vec![],
        opening_surface: rectangle(8.3, 3.4, 1.0, 1.2),
        passage: rectangle(7.5, 3.4, 1.8, 1.2),
        width_m: 1.2,
        from_z_m: 0.0,
        to_z_m: 0.0,
        head_z_m: 1.8,
        shape: catalogue::PortalShape::Trapezoid,
        top_width_m: Some(0.9),
        sill_z_m: Some(0.0),
        profile_id: None,
    });
    build_roofs(&mut unit).unwrap();
    assert!(
        unit.roofs
            .faces
            .iter()
            .any(|f| f.kind == RoofFaceKind::ShellJamb)
    );
    assert!(
        unit.roofs
            .faces
            .iter()
            .any(|f| f.kind == RoofFaceKind::ShellLintel)
    );
    let invalid = non_ground_open_edges(&unit);
    assert!(
        invalid.is_empty(),
        "first open edges {:?}",
        &invalid[..invalid.len().min(10)]
    );
    // At the central door plane and below its head, no face spans the passage.
    for z in [0.2, 0.6, 1.0, 1.4, 1.7] {
        let intercept = unit
            .roofs
            .faces
            .iter()
            .map(|f| ray_face_distance(&unit, f, [7.5, 4.0, z], [1.0, 0.0, 0.0]))
            .fold(f64::INFINITY, f64::min);
        assert!(
            intercept > 1.8,
            "porte fermée à z={z}: intercept {intercept}"
        );
    }
    let above = unit
        .roofs
        .faces
        .iter()
        .map(|f| ray_face_distance(&unit, f, [7.5, 4.0, 2.0], [1.0, 0.0, 0.0]))
        .fold(f64::INFINITY, f64::min);
    assert!(above < 1.8, "volume au-dessus de porte absent");
    for face in &unit.roofs.faces {
        let vertices: Vec<_> = face
            .vertices
            .iter()
            .map(|i| &unit.roofs.vertices[*i as usize])
            .collect();
        if vertices.iter().all(|v| v.z < 1.8 - 0.001) {
            let min_y = vertices.iter().map(|v| v.y).fold(f64::INFINITY, f64::min);
            let max_y = vertices
                .iter()
                .map(|v| v.y)
                .fold(f64::NEG_INFINITY, f64::max);
            let min_x = vertices.iter().map(|v| v.x).fold(f64::INFINITY, f64::min);
            assert!(!(min_x >= 8.3 && min_y < 4.0 && max_y > 4.0));
        }
    }
}

#[test]
fn open_vault_has_no_front_tympanum_and_requires_continuous_bearing() {
    let mut unit = fixture("RF-VAULT");
    unit.bodies[0].roof_spec.vault = Some(VaultSpec {
        open_ends: vec![VaultEnd::Start],
        bearing_ratio: 0.05,
    });
    unit.walls.push(Wall {
        id: "vault-bearing".into(),
        kind: WallKind::Exterior,
        body_id: Some("main".into()),
        level: 0,
        z_m: 0.0,
        height_m: 3.0,
        footprint: union(
            &rectangle(0.0, 0.0, 12.0, 0.4),
            &rectangle(0.0, 7.6, 12.0, 0.4),
        ),
        centerline: vec![Point { x: 0.0, y: 0.0 }, Point { x: 12.0, y: 0.0 }],
        material: "MAT-STONE-MORTAR".into(),
        party: false,
        opening_ids: vec![],
        solid: None,
        plan_section: None,
        shell_reference: false,
    });
    build_roofs(&mut unit).unwrap();
    let ends: Vec<_> = unit
        .roofs
        .faces
        .iter()
        .filter(|f| f.kind == RoofFaceKind::Tympanum)
        .collect();
    assert!(!ends.is_empty());
    assert!(ends.iter().all(|f| {
        f.vertices
            .iter()
            .all(|i| (unit.roofs.vertices[*i as usize].x - 12.0).abs() < 0.001)
    }));
    let before = unit.roofs.clone();
    unit.walls[0].footprint = rectangle(0.0, 0.0, 12.0, 0.4);
    assert!(build_roofs(&mut unit).unwrap_err().contains("Retombées"));
    assert_eq!(unit.roofs, before);
}

#[test]
fn inward_pans_drain_to_a_real_court_through_corner_valleys() {
    let mut unit = fixture("RF-HIP");
    let court = rectangle(4.0, 2.0, 4.0, 4.0);
    unit.partition.courtyards = court.clone();
    let ring = difference(&unit.bodies[0].footprint, &court);
    unit.bodies[0].footprint = ring.clone();
    unit.bodies[0].levels[0].footprint = ring.clone();
    unit.bodies[0].levels[0].floor = ring.clone();
    unit.bodies[0].roof_spec.drainage = Some(RoofDrainage::Inward);
    build_roofs(&mut unit).unwrap();
    roofs::inspect_roof_trait(&unit, roofs::RoofTrait::Inward).unwrap();
    assert!(
        unit.roofs
            .edges
            .iter()
            .filter(|e| e.kind == RoofEdgeKind::Valley)
            .count()
            >= 4
    );
    assert!(area(&intersection(&project(&unit, "main:0:main"), &court)) < 1e-5);
    for face in unit
        .roofs
        .faces
        .iter()
        .filter(|f| f.kind == RoofFaceKind::Pan)
    {
        let n = face.vertices.len() as f64;
        let x = face
            .vertices
            .iter()
            .map(|i| unit.roofs.vertices[*i as usize].x)
            .sum::<f64>()
            / n;
        let y = face
            .vertices
            .iter()
            .map(|i| unit.roofs.vertices[*i as usize].y)
            .sum::<f64>()
            / n;
        let toward = [x.clamp(4.0, 8.0) - x, y.clamp(2.0, 6.0) - y];
        assert!(face.normal[0] * toward[0] + face.normal[1] * toward[1] > 0.001);
    }
}

#[test]
fn roof_trait_witnesses_require_exported_slopes_and_junctions() {
    let mut unit = fixture("RF-MULTIPAV");
    build_roofs(&mut unit).unwrap();
    roofs::inspect_roof_trait(&unit, roofs::RoofTrait::Interlocking).unwrap();
    unit.roofs.edges.retain(|e| e.faces[1].is_none());
    assert!(roofs::inspect_roof_trait(&unit, roofs::RoofTrait::Interlocking).is_err());
    assert!(roofs::inspect_roof_trait(&fixture("RF-HIP"), roofs::RoofTrait::Inward).is_err());
}

#[test]
fn boundary_flat_contours_keep_holes_raw_corners_and_vertical_contacts() {
    let mut unit = fixture("RF-FLAT");
    let court = rectangle(4.0, 2.0, 4.0, 4.0);
    let mut domain = difference(&unit.bodies[0].footprint, &court);
    // These coordinates deliberately fall between the legacy micrometre ticks.
    for poly in &mut domain {
        for p in poly.outer.iter_mut().chain(poly.holes.iter_mut().flatten()) {
            p.x += 0.000000123;
            p.y += 0.000000234;
        }
    }
    let body = &mut unit.bodies[0];
    body.footprint = domain.clone();
    body.levels[0].footprint = domain.clone();
    body.levels[0].floor = domain.clone();
    body.roof_arms[0].domain = domain.clone();
    body.roof_spec.triangulation = Some(RoofTriangulation::Boundary);
    build_roofs(&mut unit).unwrap();
    let before = unit.roofs.clone();
    build_roofs(&mut unit).unwrap();
    assert_eq!(unit.roofs, before);
    assert!(area(&difference(&domain, &project(&unit, "main:0:main"))) < 1e-6);
    assert!(area(&difference(&project(&unit, "main:0:main"), &domain)) < 1e-6);
    for p in domain
        .iter()
        .flat_map(|p| p.outer.iter().chain(p.holes.iter().flatten()))
    {
        // The lot intersection has a measured nanometre adapter error. The
        // export must retain that precision rather than weld to a 1µm tick.
        assert!(
            unit.roofs
                .vertices
                .iter()
                .any(|v| (v.x - p.x).hypot(v.y - p.y) < 1e-8)
        );
    }
    let mut edges = std::collections::BTreeMap::new();
    for face in &unit.roofs.faces {
        for (&a, &b) in face
            .vertices
            .iter()
            .zip(face.vertices.iter().cycle().skip(1))
            .take(face.vertices.len())
        {
            *edges.entry((a.min(b), a.max(b))).or_insert(0usize) += 1;
        }
    }
    // At slab height a parapet must share the exact slab contour indices.
    for ((a, b), count) in edges {
        let a = &unit.roofs.vertices[a as usize];
        let b = &unit.roofs.vertices[b as usize];
        if a.z == 3.0 && b.z == 3.0 {
            let middle = Point {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
            };
            let hole = domain.iter().flat_map(|p| &p.holes).any(|ring| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                    .any(|(a, b)| {
                        let dx = b.x - a.x;
                        let dy = b.y - a.y;
                        let t =
                            ((middle.x - a.x) * dx + (middle.y - a.y) * dy) / (dx * dx + dy * dy);
                        (0.0..=1.0).contains(&t)
                            && (middle.x - a.x - t * dx).hypot(middle.y - a.y - t * dy) < 1e-8
                    })
            });
            assert_eq!(count, if hole { 1 } else { 2 });
        }
    }
}

#[test]
fn lightwell_remains_open_and_has_a_physical_masonry_rim() {
    let mut unit = fixture("RF-FLAT");
    let well = rectangle(4.0, 3.0, 1.0, 1.0);
    unit.bodies[0].voids = vec![well.clone()];
    unit.bodies[0].overhang_m = 0.5;
    unit.bodies[0].levels[0].footprint = difference(&unit.bodies[0].footprint, &well);
    unit.bodies[0].levels[0].roof_slab = Some(RoofSlab {
        surface: unit.bodies[0].levels[0].footprint.clone(),
        z_m: 3.0,
        walkable: true,
        access_node: None,
    });
    build_roofs(&mut unit).unwrap();
    assert!(area(&intersection(&project(&unit, "main:0:main"), &well)) < 1e-6);
    assert!(unit.roofs.faces.iter().any(|f| {
        f.kind == RoofFaceKind::Parapet
            && f.vertices.iter().all(|i| {
                let v = &unit.roofs.vertices[*i as usize];
                (v.x - 4.0).abs() < 0.001 && (3.0 - 0.001..=4.0 + 0.001).contains(&v.y)
            })
            && f.vertices
                .iter()
                .any(|i| (unit.roofs.vertices[*i as usize].z - 3.4).abs() < 0.001)
    }));
    assert!(unit.roofs.faces.iter().any(|f| {
        f.kind == RoofFaceKind::Slab
            && f.material == "MAT-STONE"
            && f.vertices
                .iter()
                .all(|i| (unit.roofs.vertices[*i as usize].z - 3.4).abs() < 0.001)
    }));
}

#[test]
fn an_inner_membrane_preserves_the_parent_roof_and_requires_its_cover() {
    let mut unit = fixture("RF-DOME");
    build_roofs(&mut unit).unwrap();
    let parent = project(&unit, "main:0:main");
    let domain = ellipse(6.0, 4.0, 1.5, 1.5, 32);
    attach_gallery(&mut unit, "inner", domain.clone(), 1.2);
    let inner = unit.features.iter_mut().find(|f| f.id == "inner").unwrap();
    inner.kind = FeatureKind::InnerMembrane;
    inner.height_m = 1.2;
    let roof = inner.roof.as_mut().unwrap();
    roof.nested = true;
    roof.owner_body_id = Some("main".into());
    roof.rf = "RF-DOME".into();
    roof.spec.dome_rise_ratio = 1.0 / 3.0;
    roof.arms = vec![RoofArm {
        domain,
        ..arm(4.5, 2.5, 3.0, 3.0)
    }];
    build_roofs(&mut unit).unwrap();
    assert!(
        unit.roofs
            .faces
            .iter()
            .any(|f| f.feature_id.as_deref() == Some("inner"))
    );
    let covered = project(&unit, "main:0:main");
    assert!(area(&difference(&parent, &covered)) + area(&difference(&covered, &parent)) < 1e-5);
    let inner_before = project(&unit, "feature:inner:roof");
    unit.access.portals.push(Portal {
        id: "parent-door".into(),
        kind: PortalKind::Door,
        from: "outside".into(),
        to: "room".into(),
        opening: [Point { x: 12.0, y: 3.5 }, Point { x: 12.0, y: 4.5 }],
        wall_id: None,
        feature_ids: vec![],
        opening_surface: rectangle(11.8, 3.5, 0.4, 1.0),
        passage: rectangle(6.5, 3.5, 5.7, 1.0),
        width_m: 1.0,
        from_z_m: 0.0,
        to_z_m: 0.0,
        head_z_m: 2.05,
        shape: catalogue::PortalShape::Rect,
        top_width_m: None,
        sill_z_m: None,
        profile_id: None,
    });
    build_roofs(&mut unit).unwrap();
    let inner_after = project(&unit, "feature:inner:roof");
    assert!(
        area(&difference(&inner_before, &inner_after))
            + area(&difference(&inner_after, &inner_before))
            < 1e-5
    );
    let before = unit.roofs.clone();
    let roof = unit
        .features
        .iter_mut()
        .find(|f| f.id == "inner")
        .unwrap()
        .roof
        .as_mut()
        .unwrap();
    roof.support_z_m = 10.0;
    for post in unit
        .features
        .iter_mut()
        .filter(|f| f.kind == FeatureKind::Post)
    {
        post.height_m = 10.0;
    }
    assert!(
        build_roofs(&mut unit)
            .unwrap_err()
            .contains("Toile intérieure")
    );
    assert_eq!(unit.roofs, before);
}

#[test]
fn an_inner_ring_beam_spans_only_between_its_real_posts() {
    let mut unit = fixture("RF-DOME");
    let domain = ellipse(6.0, 4.0, 1.5, 1.5, 64);
    attach_gallery(&mut unit, "inner-ring", domain.clone(), 1.8);
    unit.features.retain(|f| f.kind != FeatureKind::Post);
    let mut supports = vec!["ring-beam".to_string()];
    for i in 0..8 {
        let theta = std::f64::consts::TAU * i as f64 / 8.0;
        let id = format!("ring-post-{i}");
        supports.push(id.clone());
        unit.features.push(Feature {
            id,
            kind: FeatureKind::Post,
            surface: rectangle(
                6.0 + 1.5 * theta.cos() - 0.06,
                4.0 + 1.5 * theta.sin() - 0.06,
                0.12,
                0.12,
            ),
            z_m: 0.0,
            height_m: 1.8,
            material: "MAT-TIMBER-POST".into(),
            vertices3d: vec![],
            roof: None,
        });
    }
    unit.features.push(Feature {
        id: "ring-beam".into(),
        kind: FeatureKind::Beam,
        surface: difference(
            &ellipse(6.0, 4.0, 1.54, 1.54, 64),
            &ellipse(6.0, 4.0, 1.46, 1.46, 64),
        ),
        z_m: 1.72,
        height_m: 0.08,
        material: "MAT-TIMBER-POST".into(),
        vertices3d: vec![],
        roof: None,
    });
    let inner = unit
        .features
        .iter_mut()
        .find(|f| f.id == "inner-ring")
        .unwrap();
    inner.kind = FeatureKind::InnerMembrane;
    let roof = inner.roof.as_mut().unwrap();
    roof.nested = true;
    roof.owner_body_id = Some("main".into());
    roof.rf = "RF-DOME".into();
    roof.material = "MAT-HIDE".into();
    roof.supports = supports;
    roof.max_span_m = 1.5;
    roof.spec.dome_rise_ratio = 1.0 / 3.0;
    roof.arms = vec![RoofArm {
        domain,
        ..arm(4.5, 2.5, 3.0, 3.0)
    }];
    build_roofs(&mut unit).unwrap();
    let before = unit.roofs.clone();
    unit.features
        .retain(|f| !f.id.starts_with("ring-post-") || f.id == "ring-post-0");
    unit.features
        .iter_mut()
        .find(|f| f.id == "inner-ring")
        .unwrap()
        .roof
        .as_mut()
        .unwrap()
        .supports
        .retain(|id| !id.starts_with("ring-post-") || id == "ring-post-0");
    let error = build_roofs(&mut unit).unwrap_err();
    assert!(error.contains("Portée annulaire excessive"), "{error}");
    assert_eq!(before, unit.roofs);
}

#[test]
fn corbelled_courses_are_physical_and_keep_the_terrace_elevation() {
    for profile in [CorbelProfile::Dome, CorbelProfile::Barrel] {
        let mut unit = corbel_fixture(profile);
        let estimate = estimate_roof_faces(&unit).unwrap();
        build_roofs(&mut unit).unwrap();
        assert!(unit.roofs.faces.len() <= estimate);
        let soffits: Vec<_> = unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::CorbelSoffit)
            .collect();
        assert!(soffits.len() > 20);
        assert!(soffits.iter().all(|f| f.normal[2] < -0.999));
        let risers: Vec<_> = unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::CorbelRiser)
            .collect();
        assert!(risers.iter().all(|f| f.normal[2].abs() < 1e-8));
        for face in &risers {
            let vertices: Vec<_> = face
                .vertices
                .iter()
                .map(|&i| &unit.roofs.vertices[i as usize])
                .collect();
            if profile == CorbelProfile::Barrel {
                let cy = vertices.iter().map(|v| v.y).sum::<f64>() / vertices.len() as f64;
                assert!(face.normal[1] * (2.5 - cy) > 0.0);
            } else if vertices.iter().map(|v| v.z).fold(f64::INFINITY, f64::min) < 6.199 {
                let cx = vertices.iter().map(|v| v.x).sum::<f64>() / vertices.len() as f64;
                let cy = vertices.iter().map(|v| v.y).sum::<f64>() / vertices.len() as f64;
                assert!(face.normal[0] * (6.0 - cx) + face.normal[1] * (4.0 - cy) > 0.0);
            }
        }
        assert!(
            unit.roofs
                .edges
                .iter()
                .any(|e| e.kind == RoofEdgeKind::Step)
        );
        assert!(unit.roofs.edges.iter().all(|e| {
            e.faces
                .iter()
                .flatten()
                .all(|&i| (i as usize) < unit.roofs.faces.len())
        }));
        if profile == CorbelProfile::Barrel {
            assert!(
                unit.roofs
                    .groups
                    .iter()
                    .any(|g| g.room_id.as_deref() == Some("room"))
            );
            assert!(
                unit.roofs
                    .faces
                    .iter()
                    .filter(|f| f.kind == RoofFaceKind::Slab)
                    .all(|f| f
                        .vertices
                        .iter()
                        .all(|&i| (unit.roofs.vertices[i as usize].z - 4.6).abs() < 1e-8))
            );
        } else {
            assert!(unit.roofs.groups.iter().all(|g| g.id != "main:0:main"));
            assert!(
                (unit.roofs.vertices.iter().map(|v| v.z).fold(0.0, f64::max) - 6.45).abs() < 1e-8
            );
        }
        let saved = serde_json::to_string(&unit.roofs).unwrap();
        build_roofs(&mut unit).unwrap();
        assert_eq!(saved, serde_json::to_string(&unit.roofs).unwrap());
    }
}

#[test]
fn corbelled_invalid_supports_parameters_and_door_heads_fail_atomically() {
    for profile in [CorbelProfile::Dome, CorbelProfile::Barrel] {
        let unit = corbel_fixture(profile);
        for mode in 0..5 {
            let mut broken = unit.clone();
            match mode {
                0 => broken.walls.clear(),
                1 => broken.walls[0].material = "MAT-TIMBER-POST".into(),
                2 => broken.bodies[0].roof_spec.corbel.as_mut().unwrap().rise_m = 0.3,
                3 => broken.bodies[0].overhang_m = 0.2,
                _ => {
                    let mut l = broken.bodies[0].levels[0].clone();
                    l.index = 1;
                    l.z_m = l.height_m;
                    broken.bodies[0].levels.push(l);
                }
            }
            let saved = broken.clone();
            assert!(build_roofs(&mut broken).is_err(), "{profile:?} {mode}");
            assert_eq!(broken, saved);
        }
    }
    let mut unit = corbel_fixture(CorbelProfile::Barrel);
    unit.walls[0].footprint = geometry::offset(&unit.walls[0].footprint, -0.6);
    assert!(build_roofs(&mut unit).unwrap_err().contains("appui"));
    let mut unit = corbel_fixture(CorbelProfile::Barrel);
    unit.access.portals.push(Portal {
        shape: magna_urbis_houses::catalogue::PortalShape::Rect,
        top_width_m: None,
        sill_z_m: None,
        profile_id: None,
        id: "door".into(),
        kind: PortalKind::Door,
        from: "outside".into(),
        to: "room".into(),
        opening: [Point { x: 3.0, y: 1.5 }, Point { x: 4.0, y: 1.5 }],
        wall_id: Some("bearing".into()),
        feature_ids: vec![],
        opening_surface: rectangle(3.0, 0.0, 1.0, 1.5),
        passage: rectangle(3.0, 0.0, 1.0, 2.0),
        width_m: 1.0,
        from_z_m: 0.0,
        to_z_m: 0.0,
        head_z_m: 2.6,
    });
    assert!(build_roofs(&mut unit).unwrap_err().contains("linteau"));
}

#[test]
fn corbelled_wells_cut_every_ceiling_course_and_cap() {
    let mut unit = corbel_fixture(CorbelProfile::Barrel);
    let well = rectangle(4.0, 2.1, 0.8, 0.8);
    unit.bodies[0].levels[0].roof_slab.as_mut().unwrap().surface =
        difference(&unit.bodies[0].footprint, &well);
    build_roofs(&mut unit).unwrap();
    for face in unit
        .roofs
        .faces
        .iter()
        .filter(|f| f.kind == RoofFaceKind::CorbelSoffit)
    {
        let polygon = vec![Polygon {
            outer: face
                .vertices
                .iter()
                .map(|&i| {
                    let v = &unit.roofs.vertices[i as usize];
                    Point { x: v.x, y: v.y }
                })
                .collect(),
            holes: vec![],
        }];
        assert!(area(&intersection(&polygon, &well)) < 1e-7);
    }
    assert!(unit.roofs.faces.iter().any(|f| {
        f.kind == RoofFaceKind::CorbelRiser
            && f.vertices
                .iter()
                .any(|&i| (unit.roofs.vertices[i as usize].z - 4.6).abs() < 1e-8)
    }));
    let mut bad = corbel_fixture(CorbelProfile::Barrel);
    bad.bodies[0].levels[0].roof_slab.as_mut().unwrap().surface =
        difference(&bad.bodies[0].footprint, &rectangle(4.0, 1.51, 0.4, 0.4));
    assert!(
        build_roofs(&mut bad)
            .unwrap_err()
            .contains("assise de départ")
    );
}

#[test]
fn an_authoritative_hatch_opens_the_corbelled_ceiling() {
    let mut unit = corbel_fixture(CorbelProfile::Barrel);
    let well = rectangle(4.0, 2.1, 0.8, 0.8);
    unit.access.portals.push(Portal {
        shape: magna_urbis_houses::catalogue::PortalShape::Rect,
        top_width_m: None,
        sill_z_m: None,
        profile_id: None,
        id: "hatch".into(),
        kind: PortalKind::Hatch,
        from: "room".into(),
        to: "roof".into(),
        opening: [Point { x: 4.0, y: 2.1 }, Point { x: 4.8, y: 2.1 }],
        wall_id: None,
        feature_ids: vec![],
        opening_surface: well.clone(),
        passage: well.clone(),
        width_m: 0.8,
        from_z_m: 0.0,
        to_z_m: 4.6,
        head_z_m: 4.6,
    });
    build_roofs(&mut unit).unwrap();
    for face in unit.roofs.faces.iter().filter(|f| f.normal[2].abs() > 0.5) {
        let mut ring: Vec<_> = face
            .vertices
            .iter()
            .map(|&i| {
                let v = &unit.roofs.vertices[i as usize];
                Point { x: v.x, y: v.y }
            })
            .collect();
        if geometry::signed_area(&ring) < 0.0 {
            ring.reverse();
        }
        assert!(
            area(&intersection(
                &vec![Polygon {
                    outer: ring,
                    holes: vec![]
                }],
                &well
            )) < 1e-7
        );
    }
}
#[test]
fn all_22_roof_operators_have_valid_distinct_geometry() {
    let ids = [
        "RF-CONE",
        "RF-GABLE",
        "RF-HIP",
        "RF-FLAT",
        "RF-SHED",
        "RF-DOME",
        "RF-THATCH-VAULT",
        "RF-VAULT",
        "RF-CROSSVAULT",
        "RF-STEP",
        "RF-EAVES",
        "RF-CURVED",
        "RF-TIERED",
        "RF-REED-HIP",
        "RF-TENT",
        "RF-SADDLE",
        "RF-GAMBREL",
        "RF-DOME-CONE",
        "RF-STEEP-STEP",
        "RF-MULTIPAV",
        "RF-SNOW",
        "RF-SHELL",
    ];
    let mut outputs = std::collections::BTreeSet::new();
    let mut underestimated = vec![];
    for rf in ids {
        let mut unit = fixture(rf);
        if rf == "RF-EAVES" {
            unit.bodies[0].overhang_m = 1.0;
        }
        if rf == "RF-REED-HIP" {
            unit.bodies[0].roof_pitch_deg = 60.0;
            unit.bodies[0].overhang_m = 0.5;
        }
        if rf == "RF-THATCH-VAULT" {
            unit.bodies[0].roof_spec.dome_rise_ratio = 0.75;
        }
        if rf == "RF-STEP" {
            let mut upper = unit.bodies[0].levels[0].clone();
            upper.index = 1;
            upper.z_m = 3.0;
            upper.footprint = rectangle(2.0, 2.0, 8.0, 4.0);
            upper.floor = upper.footprint.clone();
            unit.bodies[0].levels[0].intermediate_cover = IntermediateCover::Terrace;
            unit.bodies[0].levels.push(upper);
        }
        build_roofs(&mut unit).unwrap_or_else(|e| panic!("{rf}: {e}"));
        let mut baseline = serde_json::json!({"roofs": unit.roofs, "features": unit.features});
        for key in ["faces", "groups"] {
            for row in baseline["roofs"][key].as_array_mut().unwrap() {
                row.as_object_mut().unwrap().remove("feature_id");
            }
        }
        for row in baseline["features"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("roof");
        }
        // Full hashes including edges passed before the pure RoofSource refactor.
        // Preserve geometry while allowing corrected physical edge classification.
        baseline["roofs"].as_object_mut().unwrap().remove("edges");
        let hash = serde_json::to_vec(&baseline)
            .unwrap()
            .iter()
            .fold(0xcbf29ce484222325_u64, |h, b| {
                (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
            });
        let expected = match rf {
            "RF-CONE" => 11941071686891862870,
            "RF-GABLE" => 13106967341850662076,
            "RF-HIP" => 4008572365893246133,
            "RF-FLAT" => 18426110685833089615,
            "RF-SHED" => 11454978659795684650,
            "RF-DOME" => 10842958107512163949,
            "RF-THATCH-VAULT" => 2761481821721387467,
            "RF-VAULT" => 2337859671534459574,
            // Degenerate holes are removed; group domains use one overlay pass.
            "RF-CROSSVAULT" => 7133908010566779628,
            "RF-STEP" => 8427841576251943673,
            "RF-EAVES" => 10582090229879128276,
            // Reviewed21: analytic nested bands. Reviewed23: eave rebased to support_z.
            "RF-CURVED" => 6676006323023596534,
            "RF-TIERED" => 12855914625504553192,
            "RF-REED-HIP" => 10365265180025087791,
            "RF-TENT" => 15399255204267543328,
            "RF-SADDLE" => 12793123485304136107,
            "RF-GAMBREL" => 16690118932100432291,
            "RF-DOME-CONE" => 10419103249420495774,
            "RF-STEEP-STEP" => 9904842017097103711,
            // Same canonical group-domain overlay as CROSSVAULT.
            "RF-MULTIPAV" => 5704826467981530825,
            "RF-SNOW" => 6385782360216761119,
            "RF-SHELL" => 9634302493777227367,
            _ => unreachable!(),
        };
        assert_eq!(hash, expected, "{rf}: existing roof geometry changed");
        assert!(!unit.roofs.faces.is_empty(), "{rf}");
        let estimate = estimate_roof_faces(&unit).unwrap();
        if estimate < unit.roofs.faces.len() {
            underestimated.push(format!("{rf}: {estimate}<{}", unit.roofs.faces.len()));
        }
        if rf == "RF-CONE" {
            for edge in unit.roofs.edges.iter().filter(|e| e.faces[1].is_some()) {
                let a = &unit.roofs.vertices[edge.vertices[0] as usize];
                let b = &unit.roofs.vertices[edge.vertices[1] as usize];
                let length = ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt();
                let distance =
                    ((6.0 - a.x) * (b.y - a.y) - (4.0 - a.y) * (b.x - a.x)).abs() / length;
                assert!(
                    distance < 0.002,
                    "cone triangulation created a non-radial edge"
                );
            }
        }
        for face in &unit.roofs.faces {
            assert!(face.vertices.len() >= 3, "{rf}");
            assert!(
                face.vertices
                    .iter()
                    .all(|&i| (i as usize) < unit.roofs.vertices.len())
            );
            let norm = face.normal.iter().map(|v| v * v).sum::<f64>();
            assert!((norm - 1.0).abs() < 1e-7, "{rf}");
            assert!(face.normal.iter().all(|v| v.is_finite()));
            if !matches!(
                face.kind,
                RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
            ) {
                assert!(
                    face.normal[2].abs() < 1e-7,
                    "{rf}: vertical normal {:?}",
                    face.normal
                );
            }
            let origin = &unit.roofs.vertices[face.vertices[0] as usize];
            for &index in &face.vertices {
                let v = &unit.roofs.vertices[index as usize];
                let distance = face.normal[0] * (v.x - origin.x)
                    + face.normal[1] * (v.y - origin.y)
                    + face.normal[2] * (v.z - origin.z);
                assert!(distance.abs() <= 0.001, "{rf}: face nonplanar {distance}");
            }
        }
        for group in &unit.roofs.groups {
            let projected = project(&unit, &group.id);
            let err = area(&difference(&group.domain, &projected))
                + area(&difference(&projected, &group.domain));
            assert!(
                err <= geometry::area_tolerance(&group.domain) * 3.0 + 0.002,
                "{rf}: projection {err}"
            );
            let sum = unit
                .roofs
                .faces
                .iter()
                .filter(|f| {
                    f.roof_group == group.id
                        && matches!(
                            f.kind,
                            RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
                        )
                })
                .map(|f| {
                    geometry::signed_area(
                        &f.vertices
                            .iter()
                            .map(|&i| {
                                let v = &unit.roofs.vertices[i as usize];
                                Point { x: v.x, y: v.y }
                            })
                            .collect::<Vec<_>>(),
                    )
                    .abs()
                })
                .sum::<f64>();
            assert!(
                (sum - area(&projected)).abs()
                    <= geometry::area_tolerance(&group.domain) * 3.0 + 0.002,
                "{rf}: overlapping projections sum={sum} union={} tol={}",
                area(&projected),
                geometry::area_tolerance(&group.domain)
            );
        }
        let geometry = (
            &unit.roofs.vertices,
            unit.roofs
                .faces
                .iter()
                .map(|f| (&f.vertices, f.normal, f.kind))
                .collect::<Vec<_>>(),
        );
        let json = serde_json::to_string(&geometry).unwrap();
        assert!(outputs.insert(json), "{rf}: duplicate geometry");
        let prior = serde_json::to_string(&unit).unwrap();
        build_roofs(&mut unit).unwrap();
        assert_eq!(
            prior,
            serde_json::to_string(&unit).unwrap(),
            "{rf}: idempotence"
        );
    }
    assert!(underestimated.is_empty(), "{}", underestimated.join(", "));
}
#[test]
fn courtyard_and_party_edges_preserve_voids() {
    let mut unit = fixture("RF-HIP");
    let court = rectangle(4.0, 3.0, 4.0, 2.0);
    let ring = difference(&rectangle(0.0, 0.0, 12.0, 8.0), &court);
    unit.partition.courtyards = court.clone();
    unit.partition.occupied = ring.clone();
    unit.bodies[0].footprint = ring.clone();
    unit.bodies[0].levels[0].footprint = ring.clone();
    unit.bodies[0].levels[0].floor = ring;
    unit.bodies[0].overhang_m = 1.0;
    unit.bodies[0].roof_arms = vec![
        arm(0.0, 0.0, 12.0, 3.0),
        arm(0.0, 5.0, 12.0, 3.0),
        arm(0.0, 0.0, 4.0, 8.0),
        arm(8.0, 0.0, 4.0, 8.0),
    ];
    unit.walls.push(Wall {
        solid: None,
        plan_section: None,
        shell_reference: false,
        id: "party".into(),
        kind: WallKind::Party,
        body_id: Some("main".into()),
        level: 0,
        z_m: 0.0,
        height_m: 3.0,
        footprint: rectangle(-0.1, 0.0, 0.2, 8.0),
        centerline: vec![Point { x: 0.0, y: 0.0 }, Point { x: 0.0, y: 8.0 }],
        material: "MAT-STONE".into(),
        party: true,
        opening_ids: vec![],
    });
    build_roofs(&mut unit).unwrap();
    for group in &unit.roofs.groups {
        let projected = project(&unit, &group.id);
        assert!(area(&intersection(&projected, &rectangle(4.25, 3.25, 3.5, 1.5))) < 0.002);
        assert!(area(&intersection(&projected, &court)) > 0.0);
        assert!(bounds(&projected)[0] >= -0.001);
    }
}
#[test]
fn composed_l_has_a_real_valley_and_stable_ties() {
    let mut unit = fixture("RF-HIP");
    let shape = union(
        &rectangle(0.0, 0.0, 12.0, 4.0),
        &rectangle(0.0, 0.0, 4.0, 8.0),
    );
    unit.bodies[0].footprint = shape.clone();
    unit.bodies[0].levels[0].footprint = shape.clone();
    unit.bodies[0].levels[0].floor = shape;
    unit.bodies[0].roof_arms = vec![arm(0.0, 0.0, 12.0, 4.0), arm(0.0, 0.0, 4.0, 8.0)];
    build_roofs(&mut unit).unwrap();
    assert!(
        unit.roofs
            .edges
            .iter()
            .any(|e| e.kind == RoofEdgeKind::Valley)
    );
    let mut twin = unit.bodies[0].clone();
    twin.id = "other".into();
    unit.bodies.push(twin);
    build_roofs(&mut unit).unwrap();
    let prior = unit.roofs.clone();
    unit.bodies.reverse();
    build_roofs(&mut unit).unwrap();
    assert_eq!(prior, unit.roofs);
}
#[test]
fn budget_and_terrace_constraints_fail_atomically() {
    let mut unit = fixture("RF-FLAT");
    unit.bodies[0].levels[0].roof_slab = Some(RoofSlab {
        surface: unit.bodies[0].footprint.clone(),
        z_m: 4.0,
        walkable: true,
        access_node: None,
    });
    assert!(build_roofs(&mut unit).is_err());
    assert!(unit.roofs.faces.is_empty());
    let mut large = fixture("RF-DOME");
    let body = large.bodies[0].clone();
    large.bodies = (0..40)
        .map(|i| Body {
            id: format!("b{i}"),
            ..body.clone()
        })
        .collect();
    let visible = estimate_roof_faces(&large).unwrap();
    assert!(visible < roofs::MAX_ROOF_FACES);
    build_roofs(&mut large).unwrap();
    assert_eq!(visible, large.roofs.faces.len());
    large.lot = rectangle(-3.0, -3.0, 820.0, 20.0);
    for (i, b) in large.bodies.iter_mut().enumerate() {
        let dx = i as f64 * 20.0;
        b.footprint = geometry::translate(&b.footprint, dx, 0.0);
        for l in &mut b.levels {
            l.footprint = geometry::translate(&l.footprint, dx, 0.0);
            l.floor = geometry::translate(&l.floor, dx, 0.0);
        }
        for a in &mut b.roof_arms {
            a.origin.x += dx;
            a.domain = geometry::translate(&a.domain, dx, 0.0);
        }
    }
    assert!(
        estimate_roof_faces(&large)
            .unwrap_err()
            .contains("Budget toitures")
    );
}

#[test]
fn higher_terrace_does_not_conflict_with_a_lower_projected_slab() {
    let mut unit = fixture("RF-STEP");
    let lower = unit.bodies[0].levels[0].clone();
    unit.bodies[0].levels[0].intermediate_cover = IntermediateCover::Terrace;
    unit.bodies[0].levels[0].roof_slab = Some(RoofSlab {
        surface: lower.footprint.clone(),
        z_m: 3.0,
        walkable: true,
        access_node: None,
    });
    let upper = Level {
        index: 1,
        z_m: 3.0,
        footprint: rectangle(2.0, 2.0, 8.0, 4.0),
        floor: rectangle(2.0, 2.0, 8.0, 4.0),
        roof_slab: Some(RoofSlab {
            surface: rectangle(2.0, 2.0, 8.0, 4.0),
            z_m: 6.0,
            walkable: true,
            access_node: None,
        }),
        ..lower
    };
    unit.bodies[0].levels.push(upper);
    unit.features.push(Feature {
        roof: None,
        id: "terrace:main:1".into(),
        kind: FeatureKind::Terrace,
        surface: rectangle(2.0, 2.0, 8.0, 4.0),
        z_m: 6.0,
        height_m: 0.18,
        material: "MAT-STONE".into(),
        vertices3d: vec![],
    });
    build_roofs(&mut unit).unwrap();
    assert!(unit.roofs.faces.iter().any(|f| f.level == 0));
    assert!(unit.roofs.faces.iter().any(|f| f.level == 1));
}

#[test]
fn a_height_step_has_one_vertical_wall_and_existing_wall_is_not_duplicated() {
    let mut unit = fixture("RF-FLAT");
    unit.bodies[0].footprint = rectangle(0.0, 0.0, 6.0, 8.0);
    unit.bodies[0].levels[0].footprint = unit.bodies[0].footprint.clone();
    unit.bodies[0].roof_spec.parapet_height_m = 0.0;
    let mut high = unit.bodies[0].clone();
    high.id = "high".into();
    high.footprint = rectangle(6.0, 0.0, 6.0, 8.0);
    high.levels[0].footprint = high.footprint.clone();
    high.levels[0].z_m = 3.0;
    unit.bodies.push(high);
    build_roofs(&mut unit).unwrap();
    let step: Vec<_> = unit
        .roofs
        .faces
        .iter()
        .filter(|f| f.kind == RoofFaceKind::StepWall)
        .collect();
    assert_eq!(step.len(), 1);
    assert_eq!(step[0].normal[2], 0.0);
    unit.walls.push(Wall {
        solid: None,
        plan_section: None,
        shell_reference: false,
        id: "existing".into(),
        kind: WallKind::Exterior,
        body_id: Some("high".into()),
        level: 0,
        z_m: 3.0,
        height_m: 3.0,
        footprint: rectangle(5.9, 0.0, 0.2, 8.0),
        centerline: vec![Point { x: 6.0, y: 0.0 }, Point { x: 6.0, y: 8.0 }],
        material: "MAT-STONE".into(),
        party: false,
        opening_ids: vec![],
    });
    build_roofs(&mut unit).unwrap();
    assert!(
        !unit
            .roofs
            .faces
            .iter()
            .any(|f| f.kind == RoofFaceKind::StepWall)
    );
}

#[test]
fn shell_door_is_a_real_low_opening_and_higher_cover_is_preserved() {
    for (kind, floor_z, head_z) in [
        (PortalKind::Door, 0.0, 2.05),
        (PortalKind::Tunnel, 1.4, 2.6),
    ] {
        let mut unit = fixture("RF-SNOW");
        unit.bodies[0].levels[0].z_m = floor_z;
        let passage = rectangle(5.5, 7.0, 1.0, 1.5);
        unit.access.portals.push(Portal {
            shape: magna_urbis_houses::catalogue::PortalShape::Rect,
            top_width_m: None,
            sill_z_m: None,
            profile_id: None,
            id: "entrance".into(),
            kind,
            from: "outside".into(),
            to: "room".into(),
            opening: [Point { x: 5.5, y: 8.0 }, Point { x: 6.5, y: 8.0 }],
            wall_id: None,
            feature_ids: vec![],
            opening_surface: rectangle(5.5, 7.8, 1.0, 0.4),
            passage: passage.clone(),
            width_m: 1.0,
            from_z_m: floor_z,
            to_z_m: floor_z,
            head_z_m: head_z,
        });
        build_roofs(&mut unit).unwrap();
        let mut upper_area = 0.0;
        for face in unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::Pan)
        {
            let projected = vec![Polygon {
                outer: face
                    .vertices
                    .iter()
                    .map(|&i| {
                        let v = &unit.roofs.vertices[i as usize];
                        Point { x: v.x, y: v.y }
                    })
                    .collect(),
                holes: vec![],
            }];
            let overlap = intersection(&projected, &passage);
            if area(&overlap) < 0.000_001 {
                continue;
            }
            upper_area += area(&overlap);
            let origin = &unit.roofs.vertices[face.vertices[0] as usize];
            for p in overlap.iter().flat_map(|p| &p.outer) {
                let z = origin.z
                    - (face.normal[0] * (p.x - origin.x) + face.normal[1] * (p.y - origin.y))
                        / face.normal[2];
                assert!(z >= head_z - 0.002, "{kind:?} blocked below lintel at {z}");
            }
        }
        assert!(upper_area > 0.01, "the cover above the lintel was removed");
    }
}

#[test]
fn overlapping_tier_eaves_keep_vertical_clearance() {
    let mut unit = fixture("RF-TIERED");
    unit.bodies[0].overhang_m = 0.6;
    unit.bodies[0].roof_spec.tier_rise_m = 0.35;
    build_roofs(&mut unit).unwrap();
    let covers: Vec<_> = unit
        .roofs
        .faces
        .iter()
        .filter(|f| f.kind == RoofFaceKind::Skirt)
        .collect();
    let projected = |face: &RoofFace| {
        vec![Polygon {
            outer: face
                .vertices
                .iter()
                .map(|&i| {
                    let v = &unit.roofs.vertices[i as usize];
                    Point { x: v.x, y: v.y }
                })
                .collect(),
            holes: vec![],
        }]
    };
    let z = |face: &RoofFace, p: Point| {
        let v = &unit.roofs.vertices[face.vertices[0] as usize];
        v.z - (face.normal[0] * (p.x - v.x) + face.normal[1] * (p.y - v.y)) / face.normal[2]
    };
    let mut overlaps = 0;
    for (i, a) in covers.iter().enumerate() {
        for b in &covers[i + 1..] {
            if a.roof_group == b.roof_group {
                continue;
            }
            let overlap = intersection(&projected(a), &projected(b));
            if area(&overlap) < 0.000_001 {
                continue;
            }
            overlaps += 1;
            let deltas: Vec<_> = overlap
                .iter()
                .flat_map(|polygon| &polygon.outer)
                .map(|&p| z(a, p) - z(b, p))
                .collect();
            assert!(
                deltas.iter().all(|d| *d > 0.002) || deltas.iter().all(|d| *d < -0.002),
                "tier roofs cross: {deltas:?}"
            );
        }
    }
    assert!(overlaps > 0, "tiered eaves must overlap in projection");
}

fn attach_gallery(unit: &mut HouseUnit, id: &str, surface: Surface, support_z: f64) {
    let mut supports = vec![];
    let mut positions = std::collections::BTreeSet::new();
    for ring in surface
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
    {
        for (a, b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let length = ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt();
            let count = (length / 3.0).ceil().max(1.0) as u32;
            for i in 0..count {
                let t = i as f64 / count as f64;
                let p = Point {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                };
                let key = ((p.x * 1000.0).round() as i64, (p.y * 1000.0).round() as i64);
                if !positions.insert(key) {
                    continue;
                }
                let post_id = format!("{id}:post:{}", supports.len());
                supports.push(post_id.clone());
                unit.features.push(Feature {
                    id: post_id,
                    kind: FeatureKind::Post,
                    surface: rectangle(p.x - 0.06, p.y - 0.06, 0.12, 0.12),
                    z_m: 0.0,
                    height_m: support_z,
                    material: "MAT-TIMBER-POST".into(),
                    vertices3d: vec![],
                    roof: None,
                });
            }
        }
    }
    unit.features.push(Feature {
        id: id.into(),
        kind: FeatureKind::Gallery,
        surface: surface.clone(),
        z_m: 0.0,
        height_m: 0.12,
        material: "MAT-TIMBER-POST".into(),
        vertices3d: vec![],
        roof: Some(RoofAttachment {
            owner_body_id: None,
            nested: false,
            level: 0,
            domain: surface,
            rf: "RF-FLAT".into(),
            spec: RoofSpec {
                parapet_height_m: 0.0,
                ..RoofSpec::default()
            },
            arms: vec![],
            support_z_m: support_z,
            pitch_deg: 0.0,
            overhang_m: 0.0,
            material: "MAT-TILE-CLAY".into(),
            frame_material: "MAT-TIMBER-POST".into(),
            supports,
            max_span_m: 4.0,
        }),
    });
}

#[test]
fn facade_and_standalone_gallery_covers_have_explicit_owners_and_supports() {
    for facade in [false, true] {
        let mut unit = fixture("RF-FLAT");
        let surface = rectangle(0.0, 8.0, 12.0, 2.0);
        attach_gallery(&mut unit, "veranda", surface.clone(), 2.5);
        if facade {
            let remove: Vec<_> = unit
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Post && bounds(&f.surface)[1] < 8.1)
                .map(|f| f.id.clone())
                .collect();
            unit.features.retain(|f| !remove.contains(&f.id));
            let roof = unit
                .features
                .iter_mut()
                .find(|f| f.id == "veranda")
                .unwrap()
                .roof
                .as_mut()
                .unwrap();
            roof.owner_body_id = Some("main".into());
            roof.supports.retain(|id| !remove.contains(id));
            roof.supports.push("facade".into());
            unit.walls.push(Wall {
                solid: None,
                plan_section: None,
                shell_reference: false,
                id: "facade".into(),
                kind: WallKind::Exterior,
                body_id: Some("main".into()),
                level: 0,
                z_m: 0.0,
                height_m: 3.0,
                footprint: rectangle(0.0, 7.85, 12.0, 0.3),
                centerline: vec![Point { x: 0.0, y: 8.0 }, Point { x: 12.0, y: 8.0 }],
                material: "MAT-STONE".into(),
                party: false,
                opening_ids: vec![],
            });
        }
        let estimate = estimate_roof_faces(&unit).unwrap();
        let counts = (
            unit.rooms.len(),
            unit.access.nodes.len(),
            unit.access.portals.len(),
        );
        build_roofs(&mut unit).unwrap();
        let group = unit
            .roofs
            .groups
            .iter()
            .find(|g| g.feature_id.as_deref() == Some("veranda"))
            .unwrap();
        assert_eq!(group.id, "feature:veranda:roof");
        assert_eq!(group.body_id, if facade { "main" } else { "" });
        assert!(area(&difference(&surface, &project(&unit, &group.id))) < 0.001);
        assert_eq!(
            counts,
            (
                unit.rooms.len(),
                unit.access.nodes.len(),
                unit.access.portals.len()
            )
        );
        assert!(estimate >= unit.roofs.faces.len());
        assert!(
            !unit
                .features
                .iter()
                .any(|f| f.id.starts_with("roof:veranda:")
                    && matches!(f.kind, FeatureKind::RoofDrain | FeatureKind::Parapet))
        );
        assert!(
            unit.roofs
                .faces
                .iter()
                .filter(|f| f.feature_id.is_some())
                .all(|f| f.normal[2] > 0.0 && f.material == "MAT-TILE-CLAY")
        );
    }
}

#[test]
fn an_upper_gallery_floor_removes_a_low_intermediate_shed() {
    let mut unit = fixture("RF-GABLE");
    let mut upper = unit.bodies[0].levels[0].clone();
    upper.index = 1;
    upper.z_m = 3.0;
    upper.footprint = rectangle(0.0, 0.0, 12.0, 6.0);
    upper.floor = upper.footprint.clone();
    unit.bodies[0].levels[0].intermediate_cover = IntermediateCover::Shed;
    unit.bodies[0].levels.push(upper);
    unit.levels.push(UnitLevel {
        index: 1,
        z_min: 3.0,
        z_max: 6.0,
    });
    let domain = rectangle(0.0, 6.0, 12.0, 2.0);
    attach_gallery(&mut unit, "upper-gallery", domain.clone(), 5.2);
    let feature = unit
        .features
        .iter_mut()
        .find(|f| f.id == "upper-gallery")
        .unwrap();
    feature.z_m = 3.0;
    feature.roof.as_mut().unwrap().level = 1;
    build_roofs(&mut unit).unwrap();
    assert!(
        !unit
            .roofs
            .groups
            .iter()
            .any(|g| g.id == "main:0:intermediate")
    );
    let group = unit
        .roofs
        .groups
        .iter()
        .find(|g| g.feature_id.as_deref() == Some("upper-gallery"))
        .unwrap();
    assert!((area(&group.domain) - area(&domain)).abs() < 1e-8);
    assert!(
        unit.roofs
            .faces
            .iter()
            .filter(|f| f.feature_id.as_deref() == Some("upper-gallery"))
            .all(|f| f
                .vertices
                .iter()
                .all(|&i| (unit.roofs.vertices[i as usize].z - 5.2).abs() < 1e-8))
    );
}

#[test]
fn slab_boundary_contacts_keep_meshes_and_real_overlaps_are_rejected() {
    let mut touching = fixture("RF-FLAT");
    touching.bodies[0].levels[0].roof_slab = Some(RoofSlab {
        surface: touching.bodies[0].footprint.clone(),
        z_m: 3.0,
        walkable: true,
        access_node: None,
    });
    attach_gallery(
        &mut touching,
        "contact",
        rectangle(0.0, 8.0, 12.0, 2.0),
        2.5,
    );
    let mut contact = touching.clone();
    let gallery = contact
        .features
        .iter_mut()
        .find(|f| f.id == "contact")
        .unwrap();
    for p in &mut gallery.surface[0].outer {
        if p.y == 8.0 {
            p.y -= 1e-8;
        }
    }
    gallery.roof.as_mut().unwrap().domain = gallery.surface.clone();
    build_roofs(&mut touching).unwrap();
    build_roofs(&mut contact).unwrap();
    assert_eq!(touching.roofs.vertices, contact.roofs.vertices);
    assert_eq!(touching.roofs.faces, contact.roofs.faces);
    assert_eq!(touching.roofs.edges, contact.roofs.edges);
    for small in [false, true] {
        let mut real = touching.clone();
        let gallery = real
            .features
            .iter_mut()
            .find(|f| f.id == "contact")
            .unwrap();
        if small {
            let tab = vec![Polygon {
                outer: vec![
                    Point { x: 1.0, y: 7.9999 },
                    Point {
                        x: 1.001,
                        y: 7.9999,
                    },
                    Point { x: 1.001, y: 8.001 },
                    Point { x: 1.0, y: 8.001 },
                ],
                holes: vec![],
            }];
            gallery.surface = union(&gallery.surface, &tab);
        } else {
            for p in &mut gallery.surface[0].outer {
                if p.y == 8.0 {
                    p.y -= 0.0001;
                }
            }
        }
        gallery.roof.as_mut().unwrap().domain = gallery.surface.clone();
        let saved = real.clone();
        assert!(
            build_roofs(&mut real)
                .unwrap_err()
                .contains("conflit avec une dalle")
        );
        assert_eq!(real, saved);
    }
}

#[test]
fn canopy_boundary_contacts_keep_meshes_and_real_main_roof_overlaps_are_rejected() {
    let mut touching = fixture("RF-GABLE");
    attach_gallery(
        &mut touching,
        "contact",
        rectangle(0.0, 8.0, 12.0, 2.0),
        3.9,
    );
    let mut contact = touching.clone();
    let gallery = contact
        .features
        .iter_mut()
        .find(|f| f.id == "contact")
        .unwrap();
    for p in &mut gallery.surface[0].outer {
        if p.y == 8.0 {
            p.y -= 1e-8;
        }
    }
    gallery.roof.as_mut().unwrap().domain = gallery.surface.clone();
    build_roofs(&mut touching).unwrap();
    build_roofs(&mut contact).unwrap();
    assert_eq!(touching.roofs.vertices, contact.roofs.vertices);
    assert_eq!(touching.roofs.faces, contact.roofs.faces);
    assert_eq!(touching.roofs.edges, contact.roofs.edges);
    let mut real = touching.clone();
    let gallery = real
        .features
        .iter_mut()
        .find(|f| f.id == "contact")
        .unwrap();
    for p in &mut gallery.surface[0].outer {
        if p.y == 8.0 {
            p.y -= 0.0001;
        }
    }
    gallery.roof.as_mut().unwrap().domain = gallery.surface.clone();
    let saved = real.clone();
    assert!(
        build_roofs(&mut real)
            .unwrap_err()
            .contains("au-dessus d'un toit")
    );
    assert_eq!(real, saved);
}

#[test]
fn declared_court_gallery_is_covered_under_body_eaves_and_its_core_stays_open() {
    let mut unit = fixture("RF-HIP");
    let court = rectangle(2.0, 2.0, 8.0, 4.0);
    let core = rectangle(3.0, 3.0, 6.0, 2.0);
    let footprint = difference(&rectangle(0.0, 0.0, 12.0, 8.0), &court);
    unit.bodies[0].footprint = footprint.clone();
    unit.bodies[0].levels[0].footprint = footprint.clone();
    unit.bodies[0].levels[0].floor = footprint;
    unit.bodies[0].roof_arms = vec![
        arm(0.0, 0.0, 12.0, 2.0),
        arm(0.0, 6.0, 12.0, 2.0),
        arm(0.0, 0.0, 2.0, 8.0),
        arm(10.0, 0.0, 2.0, 8.0),
    ];
    unit.bodies[0].overhang_m = 1.0;
    unit.partition.courtyards = court.clone();
    let gallery = difference(&court, &core);
    attach_gallery(&mut unit, "peristyle", gallery.clone(), 2.5);
    build_roofs(&mut unit).unwrap();
    let all = unit
        .roofs
        .groups
        .iter()
        .fold(vec![], |surface, g| union(&surface, &project(&unit, &g.id)));
    assert!(area(&difference(&gallery, &all)) < 0.001);
    assert!(area(&intersection(&core, &all)) < 0.001);
    let group = unit
        .roofs
        .groups
        .iter()
        .find(|g| g.feature_id.is_some())
        .unwrap();
    assert!(
        area(&group.domain) < area(&gallery) - 0.1,
        "body eaves must actually clip the attachment"
    );
}

#[test]
fn malformed_or_conflicting_gallery_covers_fail_atomically() {
    let mut base = fixture("RF-FLAT");
    attach_gallery(&mut base, "veranda", rectangle(0.0, 8.0, 12.0, 2.0), 2.5);
    build_roofs(&mut base).unwrap();
    for invalid in [
        "missing",
        "height",
        "span",
        "clearance",
        "material",
        "kind",
        "above",
        "slab",
    ] {
        let mut unit = base.clone();
        let i = unit
            .features
            .iter()
            .position(|f| f.id == "veranda")
            .unwrap();
        match invalid {
            "missing" => unit.features[i]
                .roof
                .as_mut()
                .unwrap()
                .supports
                .push("unknown".into()),
            "height" => {
                unit.features
                    .iter_mut()
                    .find(|f| f.kind == FeatureKind::Post)
                    .unwrap()
                    .height_m -= 0.1
            }
            "span" => unit.features[i].roof.as_mut().unwrap().max_span_m = 0.5,
            "clearance" => {
                unit.features[i].roof.as_mut().unwrap().support_z_m = 1.8;
                for f in unit
                    .features
                    .iter_mut()
                    .filter(|f| f.kind == FeatureKind::Post)
                {
                    f.height_m = 1.8;
                }
            }
            "material" => unit.features[i].roof.as_mut().unwrap().material = "unknown".into(),
            "kind" => unit.features[i].kind = FeatureKind::Arcade,
            "above" | "slab" => {
                unit.features.retain(|f| !f.id.starts_with("veranda"));
                attach_gallery(
                    &mut unit,
                    "veranda",
                    rectangle(1.0, 1.0, 2.0, 2.0),
                    if invalid == "above" { 4.0 } else { 2.5 },
                );
                if invalid == "slab" {
                    unit.bodies[0].levels[0].roof_slab = Some(RoofSlab {
                        surface: unit.bodies[0].footprint.clone(),
                        z_m: 3.0,
                        walkable: true,
                        access_node: None,
                    });
                }
            }
            _ => unreachable!(),
        }
        let roofs = unit.roofs.clone();
        let error = build_roofs(&mut unit).unwrap_err();
        if invalid == "above" {
            assert!(error.contains("au-dessus"), "{error}");
        }
        if invalid == "slab" {
            assert!(error.contains("dalle praticable"), "{error}");
        }
        assert_eq!(unit.roofs, roofs, "{invalid}: partial mesh mutation");
    }
}

#[test]
fn intermediate_shed_uses_an_explicit_slope_when_main_arch_has_zero_pitch() {
    let mut unit = fixture("RF-VAULT");
    unit.bodies[0].roof_pitch_deg = 0.0;
    unit.bodies[0].levels[0].intermediate_cover = IntermediateCover::Shed;
    let mut upper = unit.bodies[0].levels[0].clone();
    upper.index = 1;
    upper.z_m = 3.0;
    upper.footprint = rectangle(2.0, 2.0, 8.0, 4.0);
    upper.floor = upper.footprint.clone();
    upper.intermediate_cover = IntermediateCover::None;
    unit.bodies[0].levels.push(upper);
    build_roofs(&mut unit).unwrap();
    assert!(
        unit.roofs
            .faces
            .iter()
            .any(|f| f.rf == "RF-SHED" && f.normal[0].abs() + f.normal[1].abs() > 0.1)
    );
    assert!(
        unit.diagnostics
            .iter()
            .any(|d| d.starts_with("roof:") && d.contains("25°"))
    );
    let old = serde_json::to_string(&unit).unwrap();
    build_roofs(&mut unit).unwrap();
    assert_eq!(old, serde_json::to_string(&unit).unwrap());
}

#[test]
fn an_unspanned_beam_cannot_hide_missing_posts() {
    let mut unit = fixture("RF-FLAT");
    attach_gallery(&mut unit, "veranda", rectangle(0.0, 8.0, 12.0, 2.0), 2.5);
    let removed: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Post)
        .filter(|f| {
            let b = bounds(&f.surface);
            b[0] > 0.01 && b[2] < 11.99
        })
        .map(|f| f.id.clone())
        .collect();
    unit.features.retain(|f| !removed.contains(&f.id));
    let roof = unit
        .features
        .iter_mut()
        .find(|f| f.id == "veranda")
        .unwrap()
        .roof
        .as_mut()
        .unwrap();
    roof.supports.retain(|id| !removed.contains(id));
    roof.supports
        .extend(["beam:front".into(), "beam:back".into()]);
    for (id, y) in [("beam:front", 8.0), ("beam:back", 10.0)] {
        unit.features.push(Feature {
            id: id.into(),
            kind: FeatureKind::Beam,
            surface: rectangle(0.0, y - 0.06, 12.0, 0.12),
            z_m: 2.35,
            height_m: 0.15,
            material: "MAT-TIMBER-POST".into(),
            vertices3d: vec![],
            roof: None,
        });
    }
    let error = build_roofs(&mut unit).unwrap_err();
    assert!(error.contains("Portée de rive excessive"), "{error}");
}

#[test]
fn attachment_flat_roof_is_backwards_compatible_and_context_cannot_own_it() {
    let mut unit = fixture("RF-FLAT");
    attach_gallery(&mut unit, "veranda", rectangle(0.0, 8.0, 12.0, 2.0), 2.5);
    build_roofs(&mut unit).unwrap();
    let mut old_unit = fixture("RF-GABLE");
    build_roofs(&mut old_unit).unwrap();
    let mut old = serde_json::to_value(&old_unit).unwrap();
    for feature in old["features"].as_array_mut().unwrap() {
        feature.as_object_mut().unwrap().remove("roof");
    }
    for key in ["faces", "groups"] {
        for row in old["roofs"][key].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("feature_id");
        }
    }
    let restored: HouseUnit = serde_json::from_value(old).unwrap();
    assert_eq!(restored.features.len(), old_unit.features.len());
    assert!(restored.features.iter().all(|f| f.roof.is_none()));
    assert!(restored.roofs.faces.iter().all(|f| f.feature_id.is_none()));
    let attached = unit
        .features
        .iter()
        .find(|f| f.roof.is_some())
        .unwrap()
        .clone();
    unit.site_context.push(attached);
    let mesh = unit.roofs.clone();
    assert!(
        build_roofs(&mut unit)
            .unwrap_err()
            .contains("contexte de site")
    );
    assert_eq!(unit.roofs, mesh);
}

#[test]
fn dropping_degenerate_overlay_holes_preserves_roof_area() {
    use geo::Area;
    let exterior = geo::LineString::from(vec![
        (0.0, 0.0),
        (12.0, 0.0),
        (12.0, 8.0),
        (0.0, 8.0),
        (0.0, 0.0),
    ]);
    let holes = vec![
        geo::LineString::from(vec![(1.0, 1.0), (2.0, 1.0), (3.0, 1.0), (1.0, 1.0)]),
        geo::LineString::from(vec![
            (4.0, 1.0),
            (5.0, 1.0),
            (5.0, 1.0 + 1.0e-12),
            (4.0, 1.0),
        ]),
    ];
    let original = geo::MultiPolygon(vec![geo::Polygon::new(exterior, holes)]);
    let normalized = geometry::from_geo(&original);
    assert!((original.unsigned_area() - area(&normalized)).abs() < 1.0e-9);
    assert!(normalized.iter().all(|p| p.holes.is_empty()));
    let mut unit = fixture("RF-CROSSVAULT");
    unit.bodies[0].footprint = normalized.clone();
    unit.bodies[0].levels[0].footprint = normalized.clone();
    unit.bodies[0].levels[0].floor = normalized;
    build_roofs(&mut unit).unwrap();
    let projected = unit
        .roofs
        .groups
        .iter()
        .fold(vec![], |surface, g| union(&surface, &project(&unit, &g.id)));
    assert!((area(&projected) - 96.0).abs() < 0.001);
    assert!(
        unit.roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::Pan)
            .all(|f| f.normal[2] > 0.0)
    );
}

#[test]
fn repeated_vault_group_unions_do_not_create_ogc_hole_panics() {
    use geo::Validation;
    // AS-MIDE-B02, seed42, variation .65, unit1: the original successive
    // group unions panic despite valid individual input polygons.
    let mut unit: HouseUnit =
        serde_json::from_str(include_str!("fixtures/roof-vault-court-seed42-unit1.json")).unwrap();
    build_roofs(&mut unit).unwrap();
    assert_eq!(unit.roofs.groups.len(), 4);
    for group in &unit.roofs.groups {
        assert!(geometry::to_geo(&group.domain).is_valid(), "{}", group.id);
        let projected_area: f64 = unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.roof_group == group.id && f.normal[2] > 0.0)
            .map(|f| {
                geometry::signed_area(
                    &f.vertices
                        .iter()
                        .map(|i| {
                            let v = &unit.roofs.vertices[*i as usize];
                            Point { x: v.x, y: v.y }
                        })
                        .collect::<Vec<_>>(),
                )
                .abs()
            })
            .sum();
        assert!(
            (projected_area - area(&group.domain)).abs()
                <= geometry::area_tolerance(&group.domain) * 3.0 + 0.002,
            "{} projected area {projected_area}",
            group.id
        );
    }
    assert!(
        unit.roofs
            .faces
            .iter()
            .all(|f| f.normal.iter().all(|x| x.is_finite()))
    );
    let replay = serde_json::to_vec(&unit.roofs).unwrap();
    build_roofs(&mut unit).unwrap();
    assert_eq!(replay, serde_json::to_vec(&unit.roofs).unwrap());
}

#[test]
fn a_canopy_above_a_walkable_roof_floor_preserves_both_stages() {
    let mut unit = fixture("RF-FLAT");
    unit.bodies[0].levels[0].roof_slab = Some(RoofSlab {
        surface: unit.bodies[0].footprint.clone(),
        z_m: 3.0,
        walkable: true,
        access_node: None,
    });
    unit.levels.push(UnitLevel {
        index: 1,
        z_min: 3.0,
        z_max: 6.0,
    });
    attach_gallery(
        &mut unit,
        "upper-gallery",
        rectangle(1.0, 1.0, 2.0, 2.0),
        5.5,
    );
    for feature in &mut unit.features {
        if feature.id == "upper-gallery" {
            feature.z_m = 3.0;
            feature.roof.as_mut().unwrap().level = 1;
        } else if feature.kind == FeatureKind::Post {
            feature.z_m = 3.0;
            feature.height_m = 2.5;
        }
    }
    build_roofs(&mut unit).unwrap();
    let main = unit
        .roofs
        .groups
        .iter()
        .find(|g| g.feature_id.is_none())
        .unwrap();
    let canopy = unit
        .roofs
        .groups
        .iter()
        .find(|g| g.feature_id.as_deref() == Some("upper-gallery"))
        .unwrap();
    assert!((area(&main.domain) - 96.0).abs() < 0.001);
    assert!((area(&canopy.domain) - 4.0).abs() < 0.001);
    assert!(
        unit.roofs
            .faces
            .iter()
            .filter(|f| f.kind == RoofFaceKind::Slab && f.feature_id.is_none())
            .all(|f| f
                .vertices
                .iter()
                .all(|i| (unit.roofs.vertices[*i as usize].z - 3.0).abs() < 0.001))
    );
    assert!(
        unit.roofs
            .faces
            .iter()
            .filter(|f| f.feature_id.is_some())
            .all(|f| f
                .vertices
                .iter()
                .all(|i| unit.roofs.vertices[*i as usize].z >= 5.5 - 0.001))
    );
    let before = unit.roofs.clone();
    unit.bodies[0].levels[0].height_m = 4.0;
    unit.bodies[0].levels[0].roof_slab.as_mut().unwrap().z_m = 4.0;
    let error = build_roofs(&mut unit).unwrap_err();
    assert!(error.contains("dalle praticable"), "{error}");
    assert_eq!(before, unit.roofs);
}
