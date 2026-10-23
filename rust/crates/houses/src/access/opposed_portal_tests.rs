use super::*;
use crate::compact::CompactArchitecture;
use crate::engine::{
    FoundationPreparation, enrich_architecture, prepare_foundation_and_entry,
    resolve_urban_architecture,
};
use crate::placement::ArchitectureFunction;

#[test]
fn lazy_opposed_predicate_matches_previous_native_door_predicate() {
    // Freeze the previous eager calculation independently of the new shared
    // half-surface helper; compare actual native cuts and their final profiles.
    fn previous(a: &Surface, b: &Surface, opening: [Point; 2], strip: &Surface, width: f64) -> [bool; 2] {
        let [polygon] = strip.as_slice() else { return [false; 2] };
        let [p0, p1, p2, p3] = polygon.outer.as_slice() else { return [false; 2] };
        let first = quad([*p0, *p1, opening[1], opening[0]]);
        let second = quad([opening[0], opening[1], *p2, *p3]);
        let minimum = width * 0.12;
        [
            area(&intersection(a, &first)) >= minimum && area(&intersection(b, &second)) >= minimum,
            area(&intersection(a, &second)) >= minimum && area(&intersection(b, &first)) >= minimum,
        ]
    }

    let body = rectangle(0.0, 2.773, 7.966, 7.228);
    let lot = rectangle(-0.327, -0.327, 9.870, 10.655);
    let exterior = difference(&lot, &body);
    let interior = offset(&body, -0.316);
    let old_opening = [point(1.591, 10.328), point(0.741, 10.328)];
    let mut cases = vec![(exterior, interior, old_opening,
        segment_strip(old_opening[0], old_opening[1], 1.686), 0.85)];
    for gap in [0.316, 0.450, 0.8] {
        let source = rectangle(-2., -1., 4., 1.);
        let target = rectangle(-2., gap, 4., 1.);
        let (opening, passage) = candidate(&source, &target, 1.2, 1.8, &[]).unwrap();
        assert!(previous(&source, &target, opening, &passage, 1.2).into_iter().any(|side| side));
        let (profiled_opening, profiled) = profiled_passage(opening, &passage, 0.85).unwrap();
        // Swap only the landing domains. Re-running candidate(b, a) can also
        // reverse its opening and keep the same boolean orientation covered.
        for (a, b) in [(&source, &target), (&target, &source)] {
            cases.push((a.clone(), b.clone(), opening, passage.clone(), 1.2));
            cases.push((a.clone(), b.clone(), profiled_opening, profiled.clone(), 0.85));
        }
    }
    let mut seen = [false; 2];
    let mut rejected = false;
    for (a, b, opening, passage, width) in cases {
        let expected = previous(&a, &b, opening, &passage, width);
        assert_eq!(opposed_portal_sides(&a, &b, opening, &passage, width), expected);
        assert_eq!(has_opposed_portal_landings(&a, &b, opening, &passage, width),
            expected.into_iter().any(|side| side));
        seen[0] |= expected[0]; seen[1] |= expected[1];
        rejected |= !expected.into_iter().any(|side| side);
    }
    assert!(seen.into_iter().all(|side| side) && rejected);
}

#[test]
fn small_lot_boundary_is_not_a_door_when_both_landings_are_on_its_inner_side() {
    // Dimensions of the causal 2471 witness: the historical candidate at
    // lot.max_y touched the exterior and room, although both lay below it.
    let body = rectangle(0.0, 2.773, 7.966, 7.228);
    let lot = rectangle(-0.327, -0.327, 9.870, 10.655);
    let exterior = difference(&lot, &body);
    let interior = offset(&body, -0.316);
    let old_opening = [point(1.591, 10.328), point(0.741, 10.328)];
    let old_passage = segment_strip(old_opening[0], old_opening[1], 1.686);
    assert!(area(&intersection(&old_passage, &exterior)) >= 0.85 * 0.12);
    assert!(area(&intersection(&old_passage, &interior)) >= 0.85 * 0.12);
    assert_eq!(old_opening[0].y, bounds(&lot)[3]);
    assert!(!has_opposed_portal_landings(
        &exterior, &interior, old_opening, &old_passage, 0.85,
    ));

    let (opening, passage) = candidate(&exterior, &interior, 0.85, 1.8, &[]).unwrap();
    assert!(opening.iter().all(|p| (p.y - bounds(&body)[3]).abs() < 1e-6),
        "the selected opening must lie on the actual outer wall face: {opening:?}");
    assert!(has_opposed_portal_landings(&exterior, &interior, opening, &passage, 0.85));
    let passage_bounds = bounds(&passage);
    assert!((passage_bounds[3] - (bounds(&body)[3] + 0.2)).abs() < 1e-6);
    assert!((passage_bounds[1] - (bounds(&interior)[3] - 0.2)).abs() < 1e-6);
}

#[test]
fn native_asymmetric_passage_preserves_both_landings_and_a_thick_profiled_enclosure() {
    // Three residual witness separations, then a genuinely thick enclosure.
    // The measured gap is on the target side, never duplicated outside a.
    for gap in [0.316, 0.450, 0.365, 0.8] {
        let source = rectangle(-2., -1., 4., 1.);
        let target = rectangle(-2., gap, 4., 1.);
        for (a, b) in [(&source, &target), (&target, &source)] {
            let (opening, passage) = candidate(a, b, 1.2, 1.8, &[]).unwrap();
            let bounds = bounds(&passage);
            assert!((bounds[1] + 0.2).abs() < 1e-6, "{gap}: {bounds:?}");
            assert!((bounds[3] - gap - 0.2).abs() < 1e-6, "{gap}: {bounds:?}");
            assert!(has_opposed_portal_landings(a, b, opening, &passage, 1.2));
            let forbidden = rectangle(-3., gap * 0.25, 6., gap * 0.5);
            assert!(candidate(a, b, 1.2, 1.8, &[forbidden]).is_none(),
                "a forbidden solid in the final crossing cannot be removed");
        }
    }

    let a = rectangle(-2., -1., 4., 1.);
    let b = rectangle(-2., 0.8, 4., 1.);
    let (opening, passage) = candidate(&a, &b, 1.2, 1.8, &[]).unwrap();
    let mut unit = super::batches25_tests::lower_corridor();
    unit.access.nodes.clear();
    unit.access.portals.clear();
    let from = node(&mut unit, AccessKind::Exterior, a.clone(), 0.);
    let to = node(&mut unit, AccessKind::Circulation, b.clone(), 0.);
    unit.access.root = from.clone();
    unit.walls.push(Wall {
        id: "thick-enclosure".into(), kind: WallKind::Enclosure,
        body_id: None, level: 0, z_m: 0., height_m: 3.,
        footprint: rectangle(-2., 0., 4., 0.8),
        centerline: vec![point(-2., 0.4), point(2., 0.4)],
        material: "MAT-STONE-RUBBLE".into(), party: false, opening_ids: vec![],
        solid: None, plan_section: None, shell_reference: false,
    });
    let profile = crate::catalogue::PortalSpec {
        id: "asymmetric-enclosure-gate".into(),
        shape: crate::catalogue::PortalShape::Trapezoid,
        width_m: 0.85, top_width_m: 1.2, head_m: 2.05,
        sill_m: 0., min_clear_height_m: 1.8,
    };
    portal_with_profile(&mut unit, &from, &to, PortalKind::Gate,
        opening, passage, 0.85, vec![], Some(&profile)).unwrap();
    let retained = unit.access.portals.last().unwrap();
    let bounds = bounds(&retained.passage);
    assert!((bounds[1] + 0.2).abs() < 1e-6 && (bounds[3] - 1.0).abs() < 1e-6,
        "reducing a profile width must preserve signed depths: {bounds:?}");
    assert_eq!(retained.width_m, 0.85);
    assert!(retained.wall_id.is_some());
    assert!(has_opposed_portal_landings(&a, &b, retained.opening, &retained.passage, 0.85));
    let solids = unite(&unit.walls.iter().map(|wall| wall_section(wall, 0.01)).collect::<Vec<_>>());
    assert!(area(&intersection(&solids, &retained.passage)) < 0.0001,
        "the real thick enclosure must be cut across the final passage");
}

#[test]
fn physical_strip_door_is_retained_exactly_through_detailed_replay() {
    let mut config = HouseConfig {
        recipe: Some("EUR-MED-B02".into()),
        seed: "native-strip-plan-entry".into(),
        mode: HistoricalMode::HistoricalInspired,
        count: 1,
        ..HouseConfig::default()
    };
    config.overrides.variant = Some("default".into());
    config.overrides.floors = Some(1);
    let mut resolved = resolve_urban_architecture(
        config, ArchitectureFunction::Domestic, [40., 40.], false,
        Some([8., 20.]), Some(0.0), true,
    ).unwrap();
    assert_eq!(resolved.plan.bodies.len(), 1);
    let footprint = resolved.plan.bodies[0].footprint.clone();
    let wall_y = bounds(&footprint)[3];
    let plan_domain = unite(&[
        footprint, resolved.plan.courts.clone(), resolved.plan.paths.clone(),
    ]);
    let b = bounds(&plan_domain);
    // A tight but complete native plan lot exposes the false outer-lot option.
    // Body, court, passage, source parameters and selected draws stay intact.
    resolved.plan.lot = rectangle(b[0] - 0.327, b[1] - 0.327,
        b[2] - b[0] + 0.654, b[3] - b[1] + 0.654);
    let original = serde_json::to_vec(&resolved).unwrap();
    let prepared = match prepare_foundation_and_entry(&resolved).unwrap() {
        FoundationPreparation::Supported(value) => value,
        FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
    };
    let entry = prepared.entry.unwrap().body_entry;
    assert!(entry.opening.iter().all(|p| (p.y - wall_y).abs() < 1e-6),
        "native certificate must use the wall face, not the lot: {:?}", entry.opening);
    assert_eq!(original, serde_json::to_vec(&resolved).unwrap());
    resolved.entrance = Some(entry.clone());
    let archived = CompactArchitecture::pack(&resolved).unwrap().unpack().unwrap();
    let batch = enrich_architecture(&archived).unwrap();
    let detailed = &batch.units[0];
    assert!(detailed.access.portals.iter().any(|portal| {
        (portal.from == detailed.access.root || portal.to == detailed.access.root)
            && portal.opening == entry.opening && portal.passage == entry.passage
            && portal.wall_id.is_some()
    }), "the retained opening must cut the real detailed wall at the same coordinates");
}
