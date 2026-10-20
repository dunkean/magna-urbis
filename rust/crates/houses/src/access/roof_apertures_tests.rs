use super::*;

thread_local! {
    static PIPELINE_CAPTURE: std::cell::RefCell<Option<Vec<HouseUnit>>> = const { std::cell::RefCell::new(None) };
}

pub(super) fn capture_before_routes(unit: &HouseUnit) {
    if unit.recipe_id == "AS-HIM-B02" && unit.id == "unit-8" {
        PIPELINE_CAPTURE.with(|capture| {
            if let Some(units) = &mut *capture.borrow_mut() {
                units.push(unit.clone());
            }
        });
    }
}

fn assert_bits(a: &Surface, b: &Surface) {
    assert_eq!(a.len(), b.len());
    for (a, b) in a.iter().zip(b) {
        assert!(bits_equal(&a.outer, &b.outer));
        assert_eq!(a.holes.len(), b.holes.len());
        for (a, b) in a.holes.iter().zip(&b.holes) {
            assert!(bits_equal(a, b));
        }
    }
}

fn holed(x: f64, y: f64, w: f64, d: f64) -> Surface {
    cut(&rectangle(0.0, 0.0, 10.0, 10.0), &rectangle(x, y, w, d))
}

#[test]
fn no_eligible_hole_preserves_literal_native_union_and_order() {
    let mut source = rectangle(0.0, 0.0, 4.0, 4.0);
    source[0].outer[1].x += 2.7e-9;
    let operands = vec![source, rectangle(3.0, 1.0, 5.0, 4.0)];
    assert_bits(&conservative_union(&operands), &unite(&operands));
    let reversed: Vec<_> = operands.into_iter().rev().collect();
    assert_bits(&conservative_union(&reversed), &unite(&reversed));
}

#[test]
fn interior_offset_uses_exact_canonical_ring_and_second_cut_is_identity() {
    let mut source = rectangle(0.0, 0.0, 10.0, 10.0);
    source[0].outer[2].x += 3.1e-9;
    let aperture = offset(&rectangle(2.0, 2.0, 0.9, 1.3), -0.12);
    assert_eq!(aperture[0].outer.len(), 4);
    let result = cut(&source, &aperture);
    assert!(bits_equal(&source[0].outer, &result[0].outer));
    assert!(bits_equal(
        &canonical(&aperture[0].outer),
        &result[0].holes[0]
    ));
    assert!(signed_area(&result[0].holes[0]) < 0.0);
    assert_bits(&cut(&result, &aperture), &result);
    let other = cut(&result, &rectangle(1.0, 1.0, 0.66, 1.06));
    assert_eq!(other[0].holes.len(), 2);
    assert!(other[0].holes[0][0].x < other[0].holes[1][0].x);
}

#[test]
fn disjoint_aperture_does_not_requantify_native_source() {
    let mut source = rectangle(0.0, 0.0, 4.0, 4.0);
    source[0].outer[1].x += 2.7e-9;
    assert_bits(&cut(&source, &rectangle(7.0, 7.0, 0.66, 1.06)), &source);
}

#[test]
fn non_quadrilateral_self_crossing_and_duplicate_offsets_use_full_difference() {
    let source = rectangle(0.0, 0.0, 10.0, 10.0);
    let rings = [
        vec![
            point(1.0, 1.0),
            point(2.0, 1.0),
            point(2.2, 1.5),
            point(2.0, 2.0),
            point(1.0, 2.0),
        ],
        vec![
            point(1.0, 1.0),
            point(2.0, 2.0),
            point(1.0, 2.0),
            point(2.0, 1.0),
        ],
        vec![
            point(1.0, 1.0),
            point(2.0, 1.0),
            point(2.0, 1.0),
            point(1.0, 2.0),
        ],
    ];
    for ring in rings {
        let aperture = ring_surface(&ring);
        assert_bits(&cut(&source, &aperture), &difference(&source, &aperture));
    }
    assert!(!simple(&[
        point(0.0, 0.0),
        Point {
            x: f64::NAN,
            y: 1.0
        },
        point(2.0, 0.0)
    ]));
}

#[test]
fn outer_contact_and_aperture_containing_old_tiny_hole_keep_boolean_path() {
    let source = holed(3.0, 3.0, 0.001, 0.001);
    for aperture in [
        rectangle(0.0, 2.0, 0.66, 1.06),
        rectangle(2.8, 2.8, 0.66, 1.06),
        rectangle(3.001, 3.001, 0.66, 1.06),
    ] {
        assert_bits(&cut(&source, &aperture), &difference(&source, &aperture));
    }
}

#[test]
fn touching_nested_and_duplicate_holes_in_same_polygon_are_not_removed() {
    let a = canonical(&rectangle(1.0, 1.0, 1.0, 1.0)[0].outer);
    for b in [
        canonical(&rectangle(2.0, 2.0, 1.0, 1.0)[0].outer),
        canonical(&rectangle(1.2, 1.2, 0.2, 0.2)[0].outer),
        a.clone(),
    ] {
        let mut source = rectangle(0.0, 0.0, 10.0, 10.0);
        source[0].holes = vec![a.clone(), b];
        let operands = vec![source];
        assert_bits(&conservative_union(&operands), &unite(&operands));
    }
}

#[test]
fn noncanonical_hole_stays_in_its_original_operand() {
    for reverse in [false, true] {
        let mut source = holed(1.0, 1.0, 1.0, 1.0);
        if reverse {
            source[0].holes[0].reverse();
        } else {
            source[0].holes[0].rotate_left(1);
        }
        let operands = vec![source];
        assert_bits(&conservative_union(&operands), &unite(&operands));
    }
}

#[test]
fn another_slab_filling_a_hole_retains_old_union_but_safe_subset_is_exact() {
    let occupied = holed(2.0, 2.0, 1.0, 1.0);
    let filling = rectangle(2.5, 2.0, 1.0, 1.0);
    assert_bits(
        &cut(
            &vec![occupied[0].clone(), filling[0].clone()],
            &rectangle(2.0, 2.0, 1.0, 1.0),
        ),
        &difference(
            &vec![occupied[0].clone(), filling[0].clone()],
            &rectangle(2.0, 2.0, 1.0, 1.0),
        ),
    );
    let operands = vec![occupied.clone(), filling.clone()];
    assert_bits(&conservative_union(&operands), &unite(&operands));
    let safe = cut(
        &rectangle(20.0, 0.0, 10.0, 10.0),
        &rectangle(22.0, 2.0, 0.66, 1.06),
    );
    let operands = vec![occupied, filling, safe.clone()];
    let result = conservative_union(&operands);
    let p = result.iter().find(|p| p.outer[0].x == 20.0).unwrap();
    assert!(bits_equal(&p.holes[0], &safe[0].holes[0]));
    assert_eq!(
        area(&intersection(&result, &rectangle(2.5, 2.0, 0.5, 1.0))),
        0.5
    );
}

#[test]
fn native_construction_hole_is_preserved_below_area_epsilon() {
    // The tiny void is created by the native union, not present in any operand.
    let raw_rect = |x: f64, y: f64, w: f64, d: f64| {
        ring_surface(&[
            Point { x, y },
            Point { x: x + w, y },
            Point { x: x + w, y: y + d },
            Point { x, y: y + d },
        ])
    };
    let strips = vec![
        raw_rect(0.0, 0.0, 10.0, 4.9995),
        raw_rect(0.0, 5.0, 10.0, 5.0),
        raw_rect(0.0, 4.9995, 4.9996, 0.0005),
        raw_rect(5.0, 4.9995, 5.0, 0.0005),
    ];
    let old = unite(&strips);
    assert_eq!(old[0].holes.len(), 1);
    assert!(area(&ring_surface(&old[0].holes[0])) < 1e-6);
    let aperture = rectangle(1.0, 1.0, 0.66, 1.06);
    let mut operands = strips;
    operands[0] = cut(&operands[0], &aperture);
    let result = conservative_union(&operands);
    assert!(bits_equal(&result[0].outer, &old[0].outer));
    assert_eq!(result[0].holes.len(), 2);
    assert!(
        result[0]
            .holes
            .iter()
            .any(|h| bits_equal(h, &old[0].holes[0]))
    );
    assert!(
        result[0]
            .holes
            .iter()
            .any(|h| bits_equal(h, &canonical(&aperture[0].outer)))
    );
}

#[test]
fn true_him2_pipeline_preserves_two_native_components_at_unit8_roof16_17() {
    PIPELINE_CAPTURE.with(|capture| *capture.borrow_mut() = Some(vec![]));
    let config = HouseConfig {
        pack: "AS-HIM".into(),
        recipe: Some("AS-HIM-B02".into()),
        count: 10,
        variation: 0.65,
        seed: "42".into(),
        ..HouseConfig::default()
    };
    let result = crate::generate_batch(config);
    let captured = PIPELINE_CAPTURE.with(|capture| capture.borrow_mut().take().unwrap());
    let batch = result.unwrap();
    assert_eq!(batch.units.len(), 10);
    assert_eq!(captured.len(), 1);
    let unit = &captured[0];
    let k = walk_surface(unit, 3700).unwrap();
    let nodes: Vec<_> = unit
        .access
        .nodes
        .iter()
        .filter(|n| n.kind == AccessKind::Terrace && libm::round(n.z_m * 1000.0) as i64 == 3700)
        .collect();
    assert_eq!(nodes.len(), 4);
    let mut matched_components = BTreeSet::new();
    for id in ["unit-8:space:16", "unit-8:space:17"] {
        let node = nodes.iter().find(|n| n.id == id).unwrap();
        crate::access::native_roof_walk_component(unit, node).unwrap();
        let matches: Vec<_> = k
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                area(&difference(&vec![(*p).clone()], &node.floor)) <= 1e-6
                    && area(&difference(&node.floor, &vec![(*p).clone()])) <= 1e-6
            })
            .collect();
        assert_eq!(matches.len(), 1);
        matched_components.insert(matches[0].0);
        println!(
            "{id}: native component {}, both area differences <= 1e-6",
            matches[0].0
        );
    }
    assert_eq!(matched_components.len(), 2);
}

#[test]
fn static_collective_precondition_requires_cells_and_two_room_owners() {
    let mut unit = crate::access::public_roofs::walk_component_fixture();
    assert!(!collective(&unit));
    let captured: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../fixtures/houses/parapet-him2.json"
    ))
    .unwrap();
    unit = serde_json::from_value(captured["unit"].clone()).unwrap();
    assert!(collective(&unit));
    let original = unit.clone();
    for body in &mut unit.bodies {
        for cell in &mut body.cells {
            cell.household_id = None;
        }
    }
    assert!(!collective(&unit));
    unit = original;
    for room in &mut unit.rooms {
        room.household_id = Some("one".into());
    }
    assert!(!collective(&unit));
    let sources: Vec<_> = unit
        .bodies
        .iter()
        .flat_map(|b| &b.levels)
        .filter_map(|l| l.roof_slab.as_ref())
        .filter(|s| s.walkable && libm::round(s.z_m * 1000.0) as i64 == 5600)
        .map(|s| s.surface.clone())
        .collect();
    assert_bits(&walk_surface(&unit, 5600).unwrap(), &unite(&sources));
}

#[test]
fn hatch_trim_preserves_all_three_native_targets_on_the_second_pass() {
    let mut unit = crate::access::public_roofs::walk_component_fixture();
    let z = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == "roof")
        .unwrap()
        .z_m;
    let original = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == "roof")
        .unwrap()
        .floor
        .clone();
    let b = bounds(&original);
    let aperture = rectangle(b[0] + 0.2, b[1] + 0.2, 0.66, 1.06);
    unit.features.push(crate::layouts::feature(
        "test-terrace",
        FeatureKind::Terrace,
        original.clone(),
        z,
        0.15,
        "timber",
    ));
    let other = crate::layouts::feature(
        "test-other-cote",
        FeatureKind::Terrace,
        original.clone(),
        z + 2.8,
        0.15,
        "timber",
    );
    unit.features.push(other.clone());
    super::super::trim_walk_plane_impl(&mut unit, z, &aperture, true);
    let node = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == "roof")
        .unwrap()
        .floor
        .clone();
    let terrace = unit
        .features
        .iter()
        .find(|f| f.id == "test-terrace")
        .unwrap()
        .surface
        .clone();
    let slab = unit.bodies[0].levels[2]
        .roof_slab
        .as_ref()
        .unwrap()
        .surface
        .clone();
    assert_eq!(node[0].holes.len(), 1);
    assert_bits(&node, &terrace);
    assert_bits(&node, &slab);
    super::super::trim_walk_plane_impl(&mut unit, z, &aperture, true);
    assert_bits(
        &node,
        &unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == "roof")
            .unwrap()
            .floor,
    );
    assert_bits(
        &terrace,
        &unit
            .features
            .iter()
            .find(|f| f.id == "test-terrace")
            .unwrap()
            .surface,
    );
    assert_bits(
        &slab,
        &unit.bodies[0].levels[2].roof_slab.as_ref().unwrap().surface,
    );
    assert_eq!(
        &other,
        unit.features
            .iter()
            .find(|f| f.id == "test-other-cote")
            .unwrap()
    );
}
