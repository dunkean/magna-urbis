use super::*;

#[test]
fn occupied_low_slab_is_never_a_terminal_floor() {
    let unit = crate::access::public_roofs::walk_occupation_fixture();
    let node = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == "unit-2:space:24")
        .unwrap();
    let occupation = crate::access::public_roofs::native_link_occupation(&unit, node).unwrap();
    let mut checked = false;
    for face in &unit.roofs.faces {
        if face.kind != RoofFaceKind::Slab || face.body_id != "unit-2:body:3" {
            continue;
        }
        let clipped = bridge::clip(&vertices(&unit, face).unwrap(), &occupation).unwrap();
        if clipped.len() < 3 || clipped.iter().any(|v| (v.z - node.z_m).abs() > 1e-9) {
            continue;
        }
        let c = projection(&clipped);
        if area(&c) <= AREA_EPS {
            continue;
        }
        assert!(!terminal_slab(&unit, face, node, &c).unwrap());
        checked = true;
    }
    assert!(
        checked,
        "native low coplanar occupied contact was not measured"
    );
}

fn vertical(unit: &mut HouseUnit, a: Point, b: Point, z: f64, high: f64) {
    let offset = unit.roofs.vertices.len() as u32;
    unit.roofs.vertices.extend([
        Vertex3 { x: a.x, y: a.y, z },
        Vertex3 { x: b.x, y: b.y, z },
        Vertex3 {
            x: b.x,
            y: b.y,
            z: high,
        },
        Vertex3 {
            x: a.x,
            y: a.y,
            z: high,
        },
    ]);
    let mut face = unit.roofs.faces[0].clone();
    face.kind = RoofFaceKind::Parapet;
    face.normal = [1.0, 0.0, 0.0];
    face.vertices = (offset..offset + 4).collect();
    unit.roofs.faces.push(face);
}

#[test]
fn clockwise_native_triangles_and_holes_preserve_coverage() {
    let mut surface = rectangle(0.0, 0.0, 4.0, 4.0);
    surface[0].outer.reverse();
    let mut hole = rectangle(1.0, 1.0, 2.0, 2.0)[0].outer.clone();
    hole.reverse();
    surface[0].holes.push(hole);
    let parts = triangles(&surface).unwrap();
    assert!(parts.iter().all(|s| signed_area(&s[0].outer) > 0.0));
    assert!((parts.iter().map(area).sum::<f64>() - 12.0).abs() < AREA_EPS);
    assert!(
        area(&intersection(
            &unite(&parts),
            &rectangle(1.0, 1.0, 2.0, 2.0)
        )) <= AREA_EPS
    );
}

#[test]
fn terminal_slab_is_at_the_exact_plane_and_same_access_node() {
    let unit = outboard::eaves_fixture(0.566);
    let node = unit.access.nodes.iter().find(|n| n.id == "roof").unwrap();
    let floor = rectangle(-1.0, -3.0, 1.0, 1.0);
    prism(&unit, "departure", &floor, node.z_m, Some(node)).unwrap();
    assert!(prism(&unit, "departure", &floor, node.z_m, None).is_err());
    for mutation in 0..4 {
        let mut broken = unit.clone();
        match mutation {
            0 => {
                let ids = broken.roofs.faces[2].vertices.clone();
                for i in ids {
                    broken.roofs.vertices[i as usize].z -= 1e-6;
                }
            }
            1 => broken.bodies[0].levels[2].roof_slab = None,
            2 => {
                broken.bodies[0].levels[2]
                    .roof_slab
                    .as_mut()
                    .unwrap()
                    .surface = rectangle(10.0, 10.0, 1.0, 1.0)
            }
            _ => broken.roofs.groups[2].domain = rectangle(10.0, 10.0, 1.0, 1.0),
        }
        assert!(prism(&broken, "departure", &floor, node.z_m, Some(node)).is_err());
    }
}

#[test]
fn vertical_parapet_contacts_have_no_jamb_exemption_on_heads_or_landings() {
    let mut unit = outboard::eaves_fixture(0.566);
    let frame = Frame {
        origin: point(0.0, 0.0),
        tangent: point(1.0, 0.0),
        outward: point(0.0, 1.0),
        distance: 0.566,
    };
    vertical(&mut unit, point(1.89, -0.14), point(2.17, -0.14), 8.4, 8.8);
    assert!(
        prism(
            &unit,
            "head",
            &frame.rect(1.89, -0.14, 0.28, 0.14),
            8.4,
            None
        )
        .is_err()
    );
    let mut unit = outboard::eaves_fixture(0.566);
    let slab = unit
        .features
        .iter()
        .find(|f| f.id.ends_with(":landing:1"))
        .unwrap()
        .clone();
    // The union-produced landing keeps its derived coordinates. Construct the
    // exact tangent on that native edge; re-snapping 2.25 would invent a gap.
    let (a, b) = slab.surface[0]
        .outer
        .iter()
        .zip(slab.surface[0].outer.iter().cycle().skip(1))
        .find(|(a, b)| a.x == b.x && a.x > 2.2 && a.y != b.y)
        .unwrap();
    vertical(&mut unit, *a, *b, 2.8, 3.2);
    assert!(prism(&unit, &slab.id, &slab.surface, slab.z_m, None).is_err());
}

#[test]
fn affine_roof_intrusion_is_checked_on_the_clipped_plane() {
    let mut unit = outboard::eaves_fixture(0.566);
    let landing = unit
        .features
        .iter()
        .find(|f| f.id.ends_with(":landing:1"))
        .unwrap()
        .clone();
    let offset = unit.roofs.vertices.len() as u32;
    unit.roofs.vertices.extend([
        Vertex3 {
            x: -1.0,
            y: -1.0,
            z: 0.0,
        },
        Vertex3 {
            x: 10.0,
            y: -1.0,
            z: 10.0,
        },
        Vertex3 {
            x: -1.0,
            y: 10.0,
            z: 0.0,
        },
    ]);
    let mut face = unit.roofs.faces[0].clone();
    face.kind = RoofFaceKind::Pan;
    face.vertices = (offset..offset + 3).collect();
    face.normal = [-libm::sqrt(0.5), 0.0, libm::sqrt(0.5)];
    unit.roofs.faces.push(face);
    assert!(prism(&unit, &landing.id, &landing.surface, landing.z_m, None).is_err());
}
