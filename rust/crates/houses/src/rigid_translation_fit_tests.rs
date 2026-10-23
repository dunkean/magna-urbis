use super::*;
use crate::geometry::{area, difference, rectangle, unite};
use crate::model::Polygon;

fn polygon(points: &[[f64; 2]]) -> Surface {
    vec![Polygon {
        outer: points.iter().map(|p| Point { x: p[0], y: p[1] }).collect(),
        holes: vec![],
    }]
}

fn same<'a>(moving: &'a Surface, rights: &'a Surface) -> TranslationProblem<'a> {
    TranslationProblem {
        body: moving,
        buildable: rights,
        occupation: moving,
        architectural_rights: rights,
        roof: moving,
        roof_rights: rights,
    }
}

fn fit(outcome: TranslationOutcome) -> RigidTranslation {
    match outcome {
        TranslationOutcome::Fit(value) => value,
        value => panic!("Expected one rigid translation: {value:?}"),
    }
}

fn moved(surface: &Surface, delta: Point) -> Surface {
    let mut result = surface.clone();
    for p in &mut result {
        for r in std::iter::once(&mut p.outer).chain(p.holes.iter_mut()) {
            for q in r {
                q.x += delta.x;
                q.y += delta.y;
            }
        }
    }
    result
}

fn close(actual: Point, expected: [f64; 2]) {
    assert!(
        (actual.x - expected[0]).abs() < 1e-8 && (actual.y - expected[1]).abs() < 1e-8,
        "{actual:?} != {expected:?}"
    );
}

#[test]
fn native_passage_requires_only_a_small_translation_of_the_entire_assembly() {
    let body = rectangle(2., 1., 4., 4.);
    let passage = rectangle(3.6, -0.25, 0.8, 1.6);
    let occupation = unite(&[body.clone(), passage]);
    let roof = rectangle(1.5, 0.5, 5., 5.);
    let rights = rectangle(0., 0., 10., 10.);
    let problem = TranslationProblem {
        body: &body,
        buildable: &rights,
        occupation: &occupation,
        architectural_rights: &rights,
        roof: &roof,
        roof_rights: &rights,
    };
    let frozen = serde_json::to_vec(&(&body, &occupation, &roof)).unwrap();
    let result = fit(solve(&problem));
    close(result.delta, [0., 0.25]);
    assert!((result.distance_m - 0.25).abs() < 1e-9);
    assert_eq!(result.constraints, 12);
    for original in [&body, &occupation, &roof] {
        let translated = moved(original, result.delta);
        assert!((area(&translated) - area(original)).abs() < 1e-9);
        assert!(area(&difference(&translated, &rights)) < 1e-7);
    }
    assert_eq!(
        frozen,
        serde_json::to_vec(&(&body, &occupation, &roof)).unwrap()
    );
    assert_eq!(
        result.pending_checks,
        vec![
            PendingCheck::PhysicalTerrainAndWater,
            PendingCheck::NativeEntranceAndConnector,
            PendingCheck::NativeRoofRealization
        ]
    );
    assert_eq!(solve(&problem), TranslationOutcome::Fit(result));
}

#[test]
fn oblique_rights_project_zero_onto_the_real_constraint_and_ignore_ring_orientation() {
    let moving = rectangle(1., 1., 1., 1.);
    // x+y>=4 is the only binding edge; the nearest move is exactly (1,1).
    let rights = polygon(&[[0., 4.], [4., 0.], [10., 0.], [10., 10.], [0., 10.]]);
    let result = fit(solve(&same(&moving, &rights)));
    close(result.delta, [1., 1.]);
    assert!((result.distance_m - libm::sqrt(2.)).abs() < 1e-8);
    assert!(area(&difference(&moved(&moving, result.delta), &rights)) < 1e-7);
    let mut reversed = rights.clone();
    reversed[0].outer.reverse();
    close(fit(solve(&same(&moving, &reversed))).delta, [1., 1.]);
    let shifted_moving = moved(
        &moving,
        Point {
            x: 1_000_000.,
            y: -2_000_000.,
        },
    );
    let shifted_rights = moved(
        &rights,
        Point {
            x: 1_000_000.,
            y: -2_000_000.,
        },
    );
    close(
        fit(solve(&same(&shifted_moving, &shifted_rights))).delta,
        [1., 1.],
    );
}

#[test]
fn separate_roof_rights_zero_motion_and_unbounded_distance_are_respected() {
    let body = rectangle(5., 4., 2., 2.);
    let roof = rectangle(7., 4., 2., 2.);
    let rights = rectangle(0., 0., 10., 10.);
    let roof_rights = rectangle(0., 0., 8., 10.);
    let result = fit(solve(&TranslationProblem {
        body: &body,
        buildable: &rights,
        occupation: &body,
        architectural_rights: &rights,
        roof: &roof,
        roof_rights: &roof_rights,
    }));
    close(result.delta, [-1., 0.]);
    close(fit(solve(&same(&body, &rights))).delta, [0., 0.]);
    // No artificial2m search radius: the mathematical answer may be far.
    // This is not permission to skip terrain/access admission at that pose.
    let remote = rectangle(10., 0., 2., 2.);
    let origin = rectangle(0., 0., 2., 2.);
    close(fit(solve(&same(&origin, &remote))).delta, [10., 0.]);
}

#[test]
fn exact_contacts_can_leave_a_segment_or_single_point_of_translations() {
    let rights = rectangle(0., 0., 4., 4.);
    let segment = rectangle(0., -0.3, 4., 2.);
    close(fit(solve(&same(&segment, &rights))).delta, [0., 0.3]);
    let point = rectangle(-0.3, 0.2, 4., 4.);
    close(fit(solve(&same(&point, &rights))).delta, [0.3, -0.2]);
}

#[test]
fn incompatible_convex_constraints_are_empty_without_shrinking_or_rotating() {
    let large = rectangle(0., 0., 6., 6.);
    let triangle = polygon(&[[0., 0.], [10., 0.], [0., 10.]]);
    // Bounding boxes fit, but the real diagonal excludes every translation.
    assert_eq!(
        solve(&same(&large, &triangle)),
        TranslationOutcome::EmptyFixedDomains
    );
    let too_narrow = rectangle(0., 0., 5., 10.);
    assert_eq!(
        solve(&same(&large, &too_narrow)),
        TranslationOutcome::EmptyFixedDomains
    );
}

#[test]
fn holes_concavity_invalid_rings_and_excess_complexity_remain_unsupported() {
    let moving = rectangle(0., 0., 2., 2.);
    let mut hole = rectangle(0., 0., 10., 10.);
    hole[0]
        .holes
        .push(rectangle(4., 4., 1., 1.)[0].outer.clone());
    let concave = polygon(&[[0., 0.], [10., 0.], [10., 10.], [5., 6.], [0., 10.]]);
    let bow = polygon(&[[0., 0.], [10., 10.], [0., 10.], [10., 0.]]);
    let doubled = polygon(&[
        [0., 0.],
        [10., 0.],
        [10., 10.],
        [0., 10.],
        [0., 0.],
        [10., 0.],
        [10., 10.],
        [0., 10.],
    ]);
    let many = polygon(
        &(0..65)
            .map(|i| {
                let a = std::f64::consts::TAU * i as f64 / 65.;
                [10. * libm::cos(a), 10. * libm::sin(a)]
            })
            .collect::<Vec<_>>(),
    );
    for rights in [hole, concave, bow, doubled, many, vec![]] {
        assert!(matches!(
            solve(&same(&moving, &rights)),
            TranslationOutcome::Unsupported(_)
        ));
    }
    let rights = rectangle(0., 0., 10., 10.);
    let invalid = polygon(&[[0., 0.], [f64::NAN, 0.], [1., 1.]]);
    assert!(matches!(
        solve(&same(&invalid, &rights)),
        TranslationOutcome::Unsupported(_)
    ));
    let repeated_parts = (0..257).flat_map(|_| moving.clone()).collect();
    assert!(matches!(
        solve(&same(&repeated_parts, &rights)),
        TranslationOutcome::Unsupported(_)
    ));
}
