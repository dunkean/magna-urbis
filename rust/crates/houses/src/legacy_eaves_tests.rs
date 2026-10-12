use super::*;

fn fixture() -> HouseUnit {
    let mut unit = crate::generate_batch(HouseConfig {
        pack: "MED-ANT".into(),
        recipe: Some("MED-ANT-B01".into()),
        count: 1,
        variation: 0.0,
        ..Default::default()
    })
    .unwrap()
    .units
    .remove(0);
    unit.partition.courtyards.clear();
    unit.features.clear();
    unit.site_context.clear();
    unit.access.nodes.clear();
    unit.access.portals.clear();
    unit.walls.clear();
    unit.lot = g::rectangle(-2.0, -2.0, 10.0, 10.0);
    unit
}

fn touching_source(unit: &HouseUnit) -> RoofSource {
    let mut source = body_sources(unit).remove(0);
    source.overhang_m = 0.25;
    source.boundary_triangulation = false;
    source.level.footprint = [
        g::rectangle(0.0, 0.0, 2.0, 2.0),
        g::rectangle(2.0, 2.0, 2.0, 2.0),
    ]
    .concat();
    source.voids.clear();
    source
}

fn raw_eaves(unit: &HouseUnit, source: &RoofSource) -> Surface {
    source
        .level
        .footprint
        .iter()
        .map(|p| Polygon {
            outer: offset_ring(unit, source, &p.outer, false),
            holes: p
                .holes
                .iter()
                .map(|h| offset_ring(unit, source, h, true))
                .collect(),
        })
        .collect()
}

#[test]
fn captured_overlap_is_material_in_both_corners() {
    let capture: serde_json::Value =
        serde_json::from_str(include_str!("../tests/fixtures/legacy-eaves-overlap.json")).unwrap();
    let raw: Surface = serde_json::from_value(capture["raw"].clone()).unwrap();
    let cores: Surface = serde_json::from_value(capture["cores"].clone()).unwrap();
    let declared: Surface = serde_json::from_value(capture["declared"].clone()).unwrap();
    let material = difference(
        &legacy_eaves_domain(raw.clone(), false),
        &difference(&cores, &declared),
    );
    for x in [2.27, 12.785] {
        let corner = g::rectangle(x, 11.818, 0.718, 0.718);
        assert!(area(&intersection(&raw, &corner)) < 1e-6);
        assert!((area(&intersection(&material, &corner)) - 0.718_f64.powi(2)).abs() < 1e-6);
    }
    let witness = g::rectangle(12.785, 11.818, 0.359, 0.359);
    assert!((area(&intersection(&material, &witness)) - 0.12888099811697007).abs() < 1e-7);
}

#[test]
fn vertex_touching_cells_keep_their_overlapping_eaves() {
    let unit = fixture();
    let source = touching_source(&unit);
    let raw = raw_eaves(&unit, &source);
    let result = roof_domain(&unit, &source, &source.level);
    let corner = g::rectangle(1.75, 1.75, 0.5, 0.5);
    assert!(area(&intersection(&raw, &corner)) < 1e-6);
    assert!((area(&intersection(&result, &corner)) - 0.25).abs() < 1e-6);
    let expected = union(&vec![raw[0].clone()], &vec![raw[1].clone()]);
    assert!(area(&difference(&expected, &result)) < 1e-6);
    assert!(area(&difference(&result, &expected)) < 1e-6);
}

#[test]
fn unchanged_operands_keep_every_coordinate_bit() {
    let a = g::rectangle(0.0, 0.0, 2.0, 2.0);
    let mut disjoint = a.clone();
    disjoint.extend(g::rectangle(4.0, 4.0, 1.0, 1.0));
    let mut edge_touch = a.clone();
    edge_touch.extend(g::rectangle(2.0, 0.0, 2.0, 2.0));
    let mut vertex_touch = a.clone();
    vertex_touch.extend(g::rectangle(2.0, 2.0, 2.0, 2.0));
    for domain in [vec![], a, disjoint, edge_touch, vertex_touch] {
        assert_eq!(
            serde_json::to_vec(&domain).unwrap(),
            serde_json::to_vec(&legacy_eaves_domain(domain.clone(), false)).unwrap()
        );
    }
}

#[test]
fn a_real_hole_survives_unless_other_material_covers_it() {
    let mut holed = g::rectangle(0.0, 0.0, 10.0, 10.0);
    let mut ring = g::rectangle(4.0, 4.0, 2.0, 2.0).remove(0).outer;
    ring.reverse();
    holed[0].holes.push(ring);
    let hole = g::rectangle(4.0, 4.0, 2.0, 2.0);
    let mut raw = holed.clone();
    raw.extend(g::rectangle(9.0, 1.0, 2.0, 2.0));
    let result = legacy_eaves_domain(raw, false);
    assert_eq!(result.iter().map(|p| p.holes.len()).sum::<usize>(), 1);
    assert!(area(&intersection(&result, &hole)) < 1e-6);
    let mut covered = holed;
    covered.extend(g::rectangle(3.0, 3.0, 4.0, 4.0));
    assert!((area(&intersection(&legacy_eaves_domain(covered, false), &hole)) - 4.0).abs() < 1e-6);
}

#[test]
fn normalization_precedes_the_existing_core_lot_and_void_cuts() {
    let mut unit = fixture();
    let mut source = touching_source(&unit);
    unit.partition.courtyards = g::rectangle(0.2, 0.2, 1.3, 1.3);
    unit.lot = g::rectangle(0.0, 0.0, 3.0, 3.0);
    let void = g::rectangle(1.8, 1.8, 0.15, 0.15);
    source.voids.push(("real-void".into(), void.clone()));
    let mut ring = unit.partition.courtyards[0].outer.clone();
    ring.reverse();
    let mut core = offset_ring(&unit, &source, &ring, true);
    core.reverse();
    let cores = vec![Polygon {
        outer: core,
        holes: vec![],
    }];
    let raw = raw_eaves(&unit, &source);
    let expected = difference(
        &intersection(
            &difference(&legacy_eaves_domain(raw, false), &cores),
            &unit.lot,
        ),
        &void,
    );
    let actual = roof_domain(&unit, &source, &source.level);
    assert_eq!(actual, expected);
    for cut in [&cores, &void] {
        assert!(area(&intersection(&actual, cut)) < 1e-6);
    }
    assert!(area(&difference(&actual, &unit.lot)) < 1e-6);
    assert!(area(&intersection(&actual, &g::rectangle(2.05, 2.05, 0.1, 0.1))) > 0.0099);
}

#[test]
fn boundary_and_declared_authorities_remain_literal() {
    let unit = fixture();
    let mut source = touching_source(&unit);
    source.boundary_triangulation = true;
    let raw = raw_eaves(&unit, &source);
    assert_eq!(raw, legacy_eaves_domain(raw.clone(), true));
    let before = intersection(&difference(&raw, &vec![]), &unit.lot);
    assert_eq!(roof_domain(&unit, &source, &source.level), before);
    assert_eq!(native_domain(&unit, &source).base.eaves, raw);
    let contours = material_contours(&unit, &source);
    let eaves: Vec<_> = contours
        .iter()
        .filter(|c| c.id.contains(":eave:"))
        .map(|c| c.points.clone())
        .collect();
    assert_eq!(
        eaves,
        raw.iter().map(|p| p.outer.clone()).collect::<Vec<_>>()
    );
    let recipes = native_domain(&unit, &source)
        .base
        .eaves_recipe
        .clone()
        .unwrap();
    assert_eq!(recipes.len(), source.level.footprint.len());
    for (recipe, polygon) in recipes.iter().zip(&source.level.footprint) {
        assert_eq!(recipe.outer.raw, polygon.outer);
    }
    source.declared_domain = Some(raw.clone());
    source.boundary_triangulation = false;
    assert_eq!(roof_domain(&unit, &source, &source.level), raw);
}

#[test]
fn him2_portal41_regains_its_real_coplanar_roof_floor() {
    let mut unit: HouseUnit = serde_json::from_str(include_str!(
        "../tests/fixtures/him2-unit5-before-eaves-union.json"
    ))
    .unwrap();
    let source = body_sources(&unit)
        .into_iter()
        .find(|s| s.body_id == "unit-5:body:1" && (s.support_z_m - 2.8).abs() < 1e-9)
        .unwrap();
    assert!(!source.boundary_triangulation);
    let portal = unit
        .access
        .portals
        .iter()
        .find(|p| p.id == "unit-5:portal:41")
        .unwrap();
    let node = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == portal.to)
        .unwrap();
    let target_part = intersection(&portal.passage, &node.floor);
    assert!((area(&target_part) - 0.17).abs() < 1e-6);
    let before_structure = serde_json::to_vec(&(
        &unit.bodies,
        &unit.rooms,
        &unit.walls,
        &unit.access,
        &unit.levels,
    ))
    .unwrap();
    build_roofs(&mut unit).unwrap();
    let supports: Vec<_> = unit
        .roofs
        .faces
        .iter()
        .filter_map(|face| {
            if face.kind != RoofFaceKind::Slab {
                return None;
            }
            let vertices: Vec<_> = face
                .vertices
                .iter()
                .map(|&i| &unit.roofs.vertices[i as usize])
                .collect();
            if !vertices.iter().all(|v| (v.z - 2.8).abs() <= 1e-9) {
                return None;
            }
            Some(vec![Polygon {
                outer: vertices.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
                holes: vec![],
            }])
        })
        .collect();
    let missing = area(&difference(&target_part, &g::unite(&supports)));
    assert!(missing <= 1e-6, "real roof support missing {missing}m²");
    assert_eq!(
        before_structure,
        serde_json::to_vec(&(
            &unit.bodies,
            &unit.rooms,
            &unit.walls,
            &unit.access,
            &unit.levels
        ))
        .unwrap()
    );
}
