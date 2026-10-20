//! Whole-surface identity for canonical, strictly disjoint collective walk trims.
use super::*;

fn polygon_bounds(p: &Polygon) -> Option<[f64; 4]> {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for ring in std::iter::once(&p.outer).chain(&p.holes) {
        if ring.len() < 3 {
            return None;
        }
        for p in ring {
            if !p.x.is_finite() || !p.y.is_finite() {
                return None;
            }
            b[0] = b[0].min(p.x);
            b[1] = b[1].min(p.y);
            b[2] = b[2].max(p.x);
            b[3] = b[3].max(p.y);
        }
    }
    Some(b)
}

fn certificate(a: &Surface, b: &Surface) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let Some(aa) = a.iter().map(polygon_bounds).collect::<Option<Vec<_>>>() else {
        return false;
    };
    let Some(bb) = b.iter().map(polygon_bounds).collect::<Option<Vec<_>>>() else {
        return false;
    };
    for a in &aa {
        for b in &bb {
            let separated = if a[2] < b[0] || b[2] < a[0] {
                true
            } else {
                a[3] < b[1] || b[3] < a[1]
            };
            if !separated {
                return false;
            }
        }
    }
    true
}

fn same_bits(a: &Surface, b: &Surface) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            a.holes.len() == b.holes.len()
                && std::iter::once(&a.outer)
                    .chain(&a.holes)
                    .zip(std::iter::once(&b.outer).chain(&b.holes))
                    .all(|(a, b)| {
                        a.len() == b.len()
                            && a.iter().zip(b).all(|(a, b)| {
                                a.x.to_bits() == b.x.to_bits() && a.y.to_bits() == b.y.to_bits()
                            })
                    })
        })
}

fn canonical(a: &Surface) -> bool {
    // Read-only representation test. No boolean or replacement of Source.
    same_bits(a, &from_geo(&to_geo(a)))
}

pub(super) fn apply(a: &Surface, b: &Surface, preserve_hatch: bool, collective: bool) -> Surface {
    if collective && certificate(a, b) && canonical(a) {
        a.clone()
    } else if preserve_hatch {
        roof_apertures::cut(a, b)
    } else {
        difference(a, b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn normalized(a: Surface) -> Surface {
        from_geo(&to_geo(&a))
    }
    #[test]
    fn whole_pairwise_identity_preserves_bits_between_siblings() {
        let mut a = rectangle(0., 0., 1., 1.);
        a.extend(rectangle(3., 0., 1., 1.));
        let a = normalized(a);
        let b = rectangle(1.5, 0., 1., 1.);
        assert!(certificate(&a, &b));
        assert!(same_bits(&a, &apply(&a, &b, false, true)));
        let mut b = b;
        b.extend(rectangle(1.75, 3., 0.5, 1.));
        assert!(certificate(&a, &b));
    }
    #[test]
    fn one_contact_means_old_whole_operation() {
        let mut a = rectangle(0., 0., 1., 1.);
        a.extend(rectangle(3., 0., 1., 1.));
        let a = normalized(a);
        for b in [rectangle(1., 0., 1., 1.), rectangle(0.9, 0., 0.2, 1.)] {
            assert!(!certificate(&a, &b));
            assert!(same_bits(&apply(&a, &b, false, true), &difference(&a, &b)));
        }
    }
    #[test]
    fn one_ulp_overlap_and_holes_never_gain_identity() {
        let a = rectangle(0., 0., 1., 1.);
        let x = f64::from_bits(1.0f64.to_bits() - 1);
        let b = vec![Polygon {
            outer: vec![
                Point { x, y: 0. },
                Point { x: 2., y: 0. },
                Point { x: 2., y: 1. },
                Point { x, y: 1. },
            ],
            holes: vec![],
        }];
        assert!(!certificate(&a, &b));
        let mut a = rectangle(0., 0., 4., 4.);
        a[0].holes.push(rectangle(1., 1., 2., 2.)[0].outer.clone());
        let a = normalized(a);
        for b in [rectangle(1.5, 1.5, 0.2, 0.2), rectangle(0.5, 1.5, 1., 0.2)] {
            assert!(!certificate(&a, &b));
            assert!(same_bits(&apply(&a, &b, false, true), &difference(&a, &b)));
        }
    }
    #[test]
    fn empty_nonfinite_short_rings_and_noncanonical_keep_old_path() {
        let a = rectangle(0., 0., 1., 1.);
        let b = rectangle(2., 0., 1., 1.);
        assert!(!certificate(&vec![], &b));
        let mut bad = a.clone();
        bad[0].outer[0].x = f64::NAN;
        assert!(!certificate(&bad, &b));
        let mut bad = a.clone();
        bad[0].holes.push(vec![Point { x: 0.2, y: 0.2 }]);
        assert!(!certificate(&bad, &b));
        let mut rotated = a.clone();
        rotated[0].outer.rotate_left(1);
        assert!(!canonical(&rotated));
        assert!(same_bits(
            &apply(&rotated, &b, false, true),
            &difference(&rotated, &b)
        ));
    }
    #[test]
    fn noncollective_and_disjoint_hatches_preserve_old_operators() {
        let a = rectangle(0., 0., 1., 1.);
        let b = rectangle(2., 0., 1., 1.);
        for preserve in [false, true] {
            assert!(same_bits(
                &apply(&a, &b, preserve, false),
                &if preserve {
                    roof_apertures::cut(&a, &b)
                } else {
                    difference(&a, &b)
                }
            ));
        }
        assert!(same_bits(
            &apply(&a, &b, true, true),
            &roof_apertures::cut(&a, &b)
        ));
    }
    #[test]
    fn real_link_low_material_and_occupation_remain_authoritative() {
        let mut unit = public_roofs::walk_occupation_fixture();
        assert!(roof_apertures::collective(&unit));
        let low = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == "unit-2:space:24")
            .unwrap()
            .clone();
        roof_walk_components::native_roof_walk_component(&unit, &low).unwrap();
        let occupation = public_roofs::native_link_occupation(&unit, &low).unwrap();
        assert!(area(&occupation) > 0.09);
        let before = unit.clone();
        let far = rectangle(1000., 1000., 1., 1.);
        trim_walk_plane_impl(&mut unit, low.z_m, &far, false);
        let current = unit.access.nodes.iter().find(|n| n.id == low.id).unwrap();
        assert!(same_bits(&current.floor, &low.floor));
        roof_walk_components::native_roof_walk_component(&unit, current).unwrap();
        assert!(same_bits(
            &occupation,
            &public_roofs::native_link_occupation(&unit, current).unwrap()
        ));
        for (a, b) in before.bodies.iter().zip(&unit.bodies) {
            for (a, b) in a.levels.iter().zip(&b.levels) {
                if let (Some(a), Some(b)) = (&a.roof_slab, &b.roof_slab)
                    && (a.z_m - low.z_m).abs() < 0.001
                {
                    assert!(same_bits(&a.surface, &b.surface));
                }
            }
        }
        // A real hole beneath the native link must still remove bearing material.
        trim_walk_plane_impl(&mut unit, low.z_m, &occupation, false);
        let current = unit.access.nodes.iter().find(|n| n.id == low.id).unwrap();
        assert!(roof_walk_components::native_roof_walk_component(&unit, current).is_err());
    }
    #[test]
    fn native_fields_outside_the_three_families_keep_old_whole_difference() {
        let mut unit = public_roofs::walk_occupation_fixture();
        let before = unit.clone();
        let z = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == "unit-2:space:24")
            .unwrap()
            .z_m;
        let cut = rectangle(1000., 1000., 1., 1.);
        trim_walk_plane_impl(&mut unit, z, &cut, false);
        let mut checked = 0;
        for (a, b) in before.access.nodes.iter().zip(&unit.access.nodes) {
            if !matches!(a.kind, AccessKind::Room | AccessKind::Terrace)
                && (a.z_m - z).abs() < 0.001
            {
                assert!(same_bits(&b.floor, &difference(&a.floor, &cut)));
                checked += 1;
            }
        }
        for (a, b) in before.features.iter().zip(&unit.features) {
            if matches!(
                a.kind,
                FeatureKind::Gallery
                    | FeatureKind::Deck
                    | FeatureKind::Landing
                    | FeatureKind::FloorSlab
            ) && (a.z_m - z).abs() < 0.001
            {
                assert!(same_bits(&b.surface, &difference(&a.surface, &cut)));
                checked += 1;
            }
            if let (Some(a), Some(b)) = (&a.roof, &b.roof)
                && (a.support_z_m - z).abs() < 2.3
                && a.support_z_m >= z - 0.001
            {
                assert!(same_bits(&b.domain, &difference(&a.domain, &cut)));
                checked += 1;
            }
        }
        for (a, b) in before.bodies.iter().zip(&unit.bodies) {
            for (a, b) in a.levels.iter().zip(&b.levels) {
                if (a.z_m - z).abs() < 0.001 {
                    assert!(same_bits(&b.floor, &difference(&a.floor, &cut)));
                    checked += 1;
                }
            }
        }
        assert!(checked > 0);
    }
}
