use super::*;

fn captured() -> HouseUnit {
    let value: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../fixtures/houses/parapet-him2.json"
    ))
    .unwrap();
    let mut unit: HouseUnit = serde_json::from_value(value["unit"].clone()).unwrap();
    // serde_json lacks float_roundtrip. Rebuild the exact native detail
    // surfaces for this fixture, as roof tests rebuild the native roof mesh.
    let surfaces: Vec<_> = unit
        .bodies
        .iter()
        .flat_map(|b| {
            crate::features::beam_surfaces(b, crate::features::BEAM_SPACING_M)
                .into_iter()
                .filter(|s| area(s) >= 0.002)
        })
        .collect();
    for (f, s) in unit
        .features
        .iter_mut()
        .filter(|f| f.id.starts_with("detail-timber_bands-"))
        .zip(surfaces)
    {
        f.surface = s;
    }
    unit
}

fn proposal(unit: &HouseUnit, shift: f64) -> (AccessNode, AccessNode, Feature) {
    let base = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == "unit-2:space:24")
        .unwrap()
        .clone();
    let target = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == "unit-2:space:25")
        .unwrap()
        .clone();
    let u = Point {
        x: libm::sqrt(0.5),
        y: -libm::sqrt(0.5),
    };
    let n = Point { x: -u.y, y: u.x };
    let surface = footprint(point(14.972, 14.385), u, n, shift);
    let flight = planned_flight(surface, &base.floor, base.z_m, target.z_m).unwrap();
    (base, target, flight)
}

fn linked() -> HouseUnit {
    let mut unit = captured();
    let (base, target, flight) = proposal(&unit, -0.13);
    install(&mut unit, &base, &target, flight).unwrap();
    let f = unit
        .features
        .iter()
        .find(|f| f.id.contains(":link:"))
        .unwrap();
    let p = unit.access.portals.last().unwrap();
    validate(&unit, f, p, false).unwrap();
    unit
}

fn check(unit: &HouseUnit, roofs: bool) -> Result<(), String> {
    let f = unit
        .features
        .iter()
        .find(|f| f.id.contains(":link:"))
        .unwrap();
    let p = unit
        .access
        .portals
        .iter()
        .find(|p| p.feature_ids.contains(&f.id))
        .unwrap();
    validate(unit, f, p, roofs)
}

#[test]
fn real_corner_link_has_two_supported_bands_and_material_apertures() {
    let before = captured();
    let mut unit = linked();
    let f = unit
        .features
        .iter()
        .find(|f| f.id.contains(":link:"))
        .unwrap();
    let (low, high) = bands(f);
    let p = unit.access.portals.last().unwrap();
    assert_eq!(p.kind, PortalKind::Ladder);
    assert!(
        area(&intersection(
            &low,
            &unit
                .access
                .nodes
                .iter()
                .find(|n| n.id == p.from)
                .unwrap()
                .floor
        )) >= TERMINAL_AREA
    );
    assert!(
        area(&intersection(
            &high,
            &unit
                .access
                .nodes
                .iter()
                .find(|n| n.id == p.to)
                .unwrap()
                .floor
        )) >= TERMINAL_AREA
    );
    assert_eq!(unit.access.nodes.len(), before.access.nodes.len());
    assert_eq!(
        unit.features
            .iter()
            .filter(|f| f.kind == FeatureKind::Post)
            .count(),
        before
            .features
            .iter()
            .filter(|f| f.kind == FeatureKind::Post)
            .count()
    );
    for id in [
        "detail-timber_bands-35",
        "detail-timber_bands-36",
        "detail-timber_bands-37",
    ] {
        assert_eq!(
            unit.features.iter().find(|f| f.id == id),
            before.features.iter().find(|f| f.id == id)
        );
    }
    crate::roofs::build_roofs(&mut unit).unwrap();
    check(&unit, true).unwrap();
}

#[test]
fn centred_or_excessively_shifted_link_cannot_borrow_the_previous_route_or_lose_support() {
    for shift in [0.0, -0.2] {
        let mut unit = captured();
        let (base, target, flight) = proposal(&unit, shift);
        if shift == 0.0 {
            assert!(
                unit.access
                    .portals
                    .iter()
                    .any(|p| p.kind == PortalKind::Passage
                        && area(&intersection(&p.passage, &flight.surface)) > AREA_EPS)
            );
        }
        let outcome = install(&mut unit, &base, &target, flight)
            .and_then(|_| super::super::validate_geometry(&unit, false));
        assert!(outcome.is_err(), "shift {shift}");
    }
}

#[test]
fn native_band_certificate_rejects_uncut_overcut_lost_and_forged_material() {
    let original = captured();
    for id in ["detail-timber_bands-38", "detail-timber_bands-39"] {
        let mut unit = linked();
        unit.features
            .iter_mut()
            .find(|f| f.id == id)
            .unwrap()
            .surface = original
            .features
            .iter()
            .find(|f| f.id == id)
            .unwrap()
            .surface
            .clone();
        assert!(check(&unit, false).is_err());
    }
    for mode in 0..5 {
        let mut unit = linked();
        let f = unit
            .features
            .iter_mut()
            .find(|f| f.id == "detail-timber_bands-38")
            .unwrap();
        match mode {
            0 => f.surface = difference(&f.surface, &rectangle(17.0, 14.3, 0.2, 0.2)),
            1 => {
                f.surface.pop();
            }
            2 => f.material = "MAT-STONE-DRY".into(),
            3 => f.z_m += 0.01,
            _ => f.height_m += 0.01,
        }
        assert!(check(&unit, false).is_err(), "mode {mode}");
    }
    let mut unit = captured();
    unit.features
        .iter_mut()
        .find(|f| f.id == "detail-timber_bands-38")
        .unwrap()
        .surface = rectangle(15.0, 14.3, 0.1, 0.1);
    let (base, target, flight) = proposal(&unit, -0.13);
    assert!(install(&mut unit, &base, &target, flight).is_err());
}

#[test]
fn link_cannot_cut_shell_solid_or_structure_and_requires_its_two_real_slabs() {
    for mode in 0..5 {
        let mut unit = captured();
        let (base, target, flight) = proposal(&unit, -0.13);
        match mode {
            0 => {
                unit.walls
                    .iter_mut()
                    .find(|w| w.id == "wall:unit-2:body:2:1:10")
                    .unwrap()
                    .shell_reference = true
            }
            1 => {
                let w = unit
                    .walls
                    .iter_mut()
                    .find(|w| w.id == "wall:unit-2:body:2:1:10")
                    .unwrap();
                w.solid = Some(
                    crate::wall_geometry::prism_solid(
                        &rectangle(14.972, 14.305, 0.4, 0.08)[0],
                        w.z_m,
                        w.height_m,
                    )
                    .unwrap(),
                );
            }
            2 => {
                let clear = flight_clear(&flight);
                unit.features.push(feature(
                    "structural-frame",
                    FeatureKind::Frame,
                    clear,
                    6.05,
                    0.18,
                    "MAT-TIMBER-POST",
                ));
            }
            3 => {
                let slab = unit
                    .bodies
                    .iter_mut()
                    .find(|b| b.id == "unit-2:body:3")
                    .unwrap()
                    .levels
                    .last_mut()
                    .unwrap()
                    .roof_slab
                    .as_mut()
                    .unwrap();
                slab.surface = difference(&slab.surface, &flight.surface);
            }
            _ => {
                let slab = unit
                    .bodies
                    .iter_mut()
                    .find(|b| b.id == "unit-2:body:2")
                    .unwrap()
                    .levels
                    .last_mut()
                    .unwrap()
                    .roof_slab
                    .as_mut()
                    .unwrap();
                slab.surface = difference(&slab.surface, &flight.surface);
            }
        }
        assert!(
            install(&mut unit, &base, &target, flight).is_err(),
            "mode {mode}"
        );
    }
}

#[test]
fn terminal_obstacles_and_uncut_walls_or_terraces_stay_closed() {
    for kind in [
        FeatureKind::Frame,
        FeatureKind::RoofDrain,
        FeatureKind::Parapet,
        FeatureKind::Post,
        FeatureKind::Neighbor,
    ] {
        for upper in [false, true] {
            let mut unit = linked();
            let f = unit
                .features
                .iter()
                .find(|f| f.id.contains(":link:"))
                .unwrap();
            let (low, high) = bands(f);
            let s = if upper { high } else { low };
            let z = if upper { 6.05 } else { 5.6 };
            unit.features.push(feature(
                "late-terminal-obstacle",
                kind,
                s,
                z,
                0.3,
                "MAT-STONE-DRY",
            ));
            assert!(check(&unit, false).is_err());
        }
    }
    let original = captured();
    for mode in 0..4 {
        let mut unit = linked();
        match mode {
            0 => {
                let w = unit
                    .walls
                    .iter_mut()
                    .find(|w| w.id == "wall:unit-2:body:2:1:10")
                    .unwrap();
                *w = original
                    .walls
                    .iter()
                    .find(|source| source.id == w.id)
                    .unwrap()
                    .clone();
            }
            1 => {
                unit.walls
                    .iter_mut()
                    .find(|w| w.id == "wall:unit-2:body:2:1:10")
                    .unwrap()
                    .height_m += 0.01
            }
            2 => {
                unit.features
                    .iter_mut()
                    .find(|f| f.id == "terrace:unit-2:body:2:1")
                    .unwrap()
                    .z_m += 0.01
            }
            _ => {
                let f = unit
                    .features
                    .iter_mut()
                    .find(|f| f.id == "terrace:unit-2:body:2:1")
                    .unwrap();
                f.surface = original
                    .features
                    .iter()
                    .find(|source| source.id == f.id)
                    .unwrap()
                    .surface
                    .clone();
            }
        }
        assert!(check(&unit, false).is_err());
    }
}

#[test]
fn a_private_pair_and_a_rise_outside_the_upper_assise_are_refused() {
    let mut unit = captured();
    let (base, mut target, _) = proposal(&unit, -0.13);
    target.z_m = base.z_m + 0.56;
    assert!(!add_route(&mut unit, &[base], &target).unwrap());
    let mut unit = captured();
    let (mut base, mut target, flight) = proposal(&unit, -0.13);
    base.household_id = Some("private".into());
    target.household_id = Some("private".into());
    for n in &mut unit.access.nodes {
        if n.id == base.id || n.id == target.id {
            n.household_id = Some("private".into());
        }
    }
    assert!(install(&mut unit, &base, &target, flight).is_err());
}
