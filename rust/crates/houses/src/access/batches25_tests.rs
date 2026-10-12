use super::*;

pub(super) fn lower_corridor() -> HouseUnit {
    let mut unit = HouseUnit {
        id: "probe".into(),
        recipe_id: "probe".into(),
        variant_id: "probe".into(),
        label: "probe".into(),
        role: Role::Dwelling,
        transform: Transform {
            origin: point(0.0, 0.0),
            orientation_deg: 0.0,
        },
        lot: rectangle(-10.0, -10.0, 30.0, 30.0),
        partition: Partition {
            occupied: vec![],
            courtyards: vec![],
            circulation: vec![],
            service: vec![],
            residual: vec![],
        },
        level_partitions: vec![],
        levels: vec![],
        bodies: vec![],
        rooms: vec![],
        features: vec![],
        walls: vec![],
        site_context: vec![],
        access: AccessGraph {
            root: String::new(),
            nodes: vec![],
            portals: vec![],
        },
        roofs: RoofMesh::default(),
        diagnostics: vec![],
    };
    let ground = node(
        &mut unit,
        AccessKind::Exterior,
        rectangle(-2.0, -2.0, 16.0, 10.0),
        0.0,
    );
    unit.access.root = ground;
    node(
        &mut unit,
        AccessKind::Circulation,
        rectangle(0.0, 0.0, 12.0, 1.4),
        -2.4,
    );
    let from = node(
        &mut unit,
        AccessKind::StairLanding,
        rectangle(1.0, 0.25, 1.0, 0.85),
        -2.4,
    );
    let to = node(
        &mut unit,
        AccessKind::StairLanding,
        rectangle(10.0, 0.25, 1.0, 0.85),
        -2.4,
    );
    portal(
        &mut unit,
        &from,
        &to,
        PortalKind::Passage,
        [point(2.0, 0.25), point(2.0, 1.1)],
        rectangle(1.0, 0.25, 10.0, 0.85),
        0.85,
        vec![],
    )
    .unwrap();
    unit
}

#[test]
fn corridor_doors_use_the_native_floor_edge_before_millimetre_rounding() {
    let body = rectangle(0.0, 0.0, 31.361, 6.002);
    let corridor = rectangle(0.0, 2.401, 31.361, 1.2);
    let interior = offset(&body, -0.327);
    let cells: Vec<_> = difference(&body, &corridor)
        .into_iter()
        .map(|p| vec![p])
        .collect();
    assert_eq!(cells.len(), 2);
    for (i, cell) in cells.iter().enumerate() {
        assert!(has_corridor_entry(
            cell,
            &corridor,
            Some((&interior, 0.327)),
            &[cells[1 - i].clone()]
        ));
    }
    assert!(!has_corridor_entry(
        &rectangle(1.0, 0.0, 2.0, 1.0),
        &corridor,
        Some((&interior, 0.327)),
        &[]
    ));
    assert!(!has_corridor_entry(
        &rectangle(-2.0, -2.0, 2.0, 2.0),
        &rectangle(0.0, 0.0, 10.0, 1.2),
        None,
        &[]
    ));
    assert!(!has_corridor_entry(
        &rectangle(0.0, 0.0, 1.176, 3.0),
        &rectangle(0.0, 3.0, 10.0, 1.2),
        Some((&rectangle(-1.0, -1.0, 12.0, 6.0), 0.327)),
        &[]
    ));
}

#[test]
fn the_exact_him2_private_floor_cannot_house_the_shaft_and_a_real_room() {
    let floor = rectangle(6.060, 12.782, 1.355, 1.082);
    assert!(anchor(&floor, 0.9, 1.3).is_none());
    let hole = rectangle(6.087, 12.873, 1.3, 0.9);
    assert!(area(&difference(&hole, &floor)) < 1e-6);
    let remaining = difference(&floor, &hole);
    assert!(area(&remaining) > 0.29 && area(&remaining) < 0.45);
    assert!((area(&floor) - area(&remaining) - 1.17).abs() < 1e-6);
}

#[test]
fn a_hatch_cuts_the_same_plane_in_node_slab_and_terrace_feature() {
    let value: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../fixtures/houses/parapet-him2.json"
    ))
    .unwrap();
    let template: HouseUnit = serde_json::from_value(value["unit"].clone()).unwrap();
    let mut unit = lower_corridor();
    let z = 5.6;
    let floor = rectangle(0.0, 0.0, 4.0, 4.0);
    let cut = rectangle(1.0, 1.0, 0.9, 1.3);
    let expected = difference(&floor, &cut);
    let id = node(&mut unit, AccessKind::Terrace, floor.clone(), z);
    unit.features.push(feature(
        "terrace-at-hatch",
        FeatureKind::Terrace,
        floor.clone(),
        z,
        0.15,
        "MAT-ADOBE",
    ));
    unit.features.push(feature(
        "terrace-other-level",
        FeatureKind::Terrace,
        floor.clone(),
        z + 2.8,
        0.15,
        "MAT-ADOBE",
    ));
    let mut body = template.bodies[0].clone();
    body.levels.truncate(1);
    body.levels[0].roof_slab = Some(RoofSlab {
        surface: floor.clone(),
        z_m: z,
        walkable: true,
        access_node: Some(id.clone()),
    });
    unit.bodies.push(body);
    trim_walk_plane(&mut unit, z, &cut);
    assert_eq!(
        unit.access.nodes.iter().find(|n| n.id == id).unwrap().floor,
        expected
    );
    assert_eq!(
        unit.bodies[0].levels[0].roof_slab.as_ref().unwrap().surface,
        expected
    );
    assert_eq!(unit.features[0].surface, expected);
    assert_eq!(unit.features[1].surface, floor);
}

#[test]
fn a_shared_passage_is_public_supported_and_at_one_height() {
    let unit = lower_corridor();
    let p = &unit.access.portals[0];
    assert!(passage_is_shareable(&unit, p, -2.4, &unit.access.root));
    for kind in [PortalKind::Door, PortalKind::Stair, PortalKind::Ladder] {
        let mut changed = p.clone();
        changed.kind = kind;
        assert!(!passage_is_shareable(
            &unit,
            &changed,
            -2.4,
            &unit.access.root
        ));
    }
    let mut changed = p.clone();
    changed.to_z_m = 0.4;
    assert!(!passage_is_shareable(
        &unit,
        &changed,
        -2.4,
        &unit.access.root
    ));
    changed = p.clone();
    changed.from = unit.access.root.clone();
    assert!(!passage_is_shareable(
        &unit,
        &changed,
        -2.4,
        &unit.access.root
    ));
    changed = p.clone();
    changed.passage = rectangle(-2.0, 0.25, 14.0, 0.85);
    assert!(!passage_is_shareable(
        &unit,
        &changed,
        -2.4,
        &unit.access.root
    ));
}

#[test]
fn a_shared_passage_can_only_overlap_the_terminal_floor() {
    let unit = lower_corridor();
    let target = &unit.access.nodes[1].floor;
    let ground = &unit.access.nodes[0].floor;
    let body = rectangle(0.0, -4.0, 12.0, 4.0);
    let shared = unit.access.portals[0].passage.clone();
    let selected = choose_exterior_flight(&unit, target, ground, &body, &shared, 0.9, 2.6).unwrap();
    let (start, end) = flight_edges(&selected, target).unwrap();
    assert!(area(&intersection(&selected, &shared)) > 0.003);
    assert!(
        area(&difference(
            &intersection(&selected, &shared),
            &end_band(start, end, 0.35)
        )) <= 1e-6
    );
    assert!(
        choose_exterior_flight(
            &unit,
            target,
            ground,
            &union(&body, &shared),
            &vec![],
            0.9,
            2.6
        )
        .is_none()
    );
    assert!(
        choose_exterior_flight(
            &unit,
            target,
            ground,
            &body,
            &rectangle(0.0, 0.25, 12.0, 2.85),
            0.9,
            2.6
        )
        .is_none()
    );
    for kind in [FeatureKind::Neighbor, FeatureKind::Water] {
        let mut blocked = unit.clone();
        blocked.site_context.push(feature(
            "obstacle",
            kind,
            blocked.lot.clone(),
            0.0,
            3.0,
            "MAT-STONE-DRY",
        ));
        assert!(
            choose_exterior_flight(
                &blocked,
                target,
                ground,
                &exterior_obstacles(&blocked),
                &shared,
                0.9,
                2.6
            )
            .is_none()
        );
    }
}

#[test]
fn trench_walls_leave_the_shared_lower_route_open_and_supported() {
    let mut unit = lower_corridor();
    let target = unit.access.nodes[1].floor.clone();
    let ground = unit.access.nodes[0].floor.clone();
    let shared = unit.access.portals[0].passage.clone();
    let ids = vec![unit.access.portals[0].id.clone()];
    let selected = choose_exterior_flight(
        &unit,
        &target,
        &ground,
        &rectangle(0.0, -4.0, 12.0, 4.0),
        &shared,
        0.9,
        2.6,
    )
    .unwrap();
    let (start, end) = flight_edges(&selected, &target).unwrap();
    let terminal = end_band(start, end, 0.35);
    trim_walk_plane(&mut unit, -2.4, &difference(&selected, &terminal));
    trench_with_open_end(&mut unit, &selected, -2.4, Some(&terminal));
    validate_shared_passages(&unit, &ids, -2.4).unwrap();
    assert!(
        unit.walls
            .iter()
            .all(|w| area(&intersection(&w.footprint, &shared)) <= 1e-6)
    );
    let mut blocked = unit.clone();
    let mut wall = blocked.walls[0].clone();
    wall.id = "wall-in-shared-route".into();
    wall.footprint = rectangle(5.0, 0.5, 0.2, 0.2);
    blocked.walls.push(wall);
    assert!(
        validate_shared_passages(&blocked, &ids, -2.4)
            .unwrap_err()
            .contains("mur de tranchée")
    );
    unit.access.nodes[1].floor = vec![];
    assert!(
        validate_shared_passages(&unit, &ids, -2.4)
            .unwrap_err()
            .contains("non porté")
    );
}
