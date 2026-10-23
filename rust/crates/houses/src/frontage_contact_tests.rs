use super::*;

fn p(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn fit(entry: Point, street: [Point; 2], width: f64) -> FrontageContact {
    match solve(entry, street, width) {
        ContactOutcome::Fit(value) => value,
        result => panic!("Expected an analytic contact: {result:?}"),
    }
}

fn scalar_margin(entry: Point, street: [Point; 2], width: f64, s: f64) -> [f64; 2] {
    let [a, b] = street;
    let length = libm::hypot(b.x - a.x, b.y - a.y);
    let (tx, ty) = ((b.x - a.x) / length, (b.y - a.y) / length);
    let (ex, ey) = (entry.x - a.x, entry.y - a.y);
    let (u, v) = (ex * tx + ey * ty, (-ex * ty + ey * tx).abs());
    let half = width * 0.5 * libm::hypot(v, s - u) / v;
    [s - half, length - s - half]
}

#[test]
fn real_3537_uses_the_cap_equation_instead_of_a_fixed_endpoint_margin() {
    let entry = p(1.3, 19.037);
    let street = [
        p(3.273473033861575, 19.576274103331997),
        p(0.9373521978320412, 19.51884445330084),
    ];
    let length = libm::hypot(street[1].x - street[0].x, street[1].y - street[0].y);
    let old = scalar_margin(entry, street, 0.8, length - 0.4);
    assert!((old[1] + 0.002014735).abs() < 1e-9);

    let value = fit(entry, street, 0.8);
    assert!((length - value.distance_on_street_m - 0.4021978637363217).abs() < 1e-12);
    assert!((value.point.x - 1.3394285843872087).abs() < 1e-12);
    assert!((value.point.y - 19.528728833342115).abs() < 1e-12);
    for s in [
        value.feasible_interval_m[0],
        value.distance_on_street_m,
        value.feasible_interval_m[1],
    ] {
        assert!(
            scalar_margin(entry, street, 0.8, s)
                .into_iter()
                .all(|d| d >= 0.)
        );
    }
    // The entrance projects beyond the upper feasible endpoint. Moving even
    // one micrometre towards that projection violates the real cap equation.
    assert!(scalar_margin(entry, street, 0.8, value.distance_on_street_m + 1e-6)[1] < 0.);
    let reverse = fit(entry, [street[1], street[0]], 0.8);
    assert!(
        libm::hypot(
            reverse.point.x - value.point.x,
            reverse.point.y - value.point.y
        ) < 1e-12
    );
    assert_eq!(value, fit(entry, street, 0.8));
}

#[test]
fn perpendicular_projection_and_a_nearby_entrance_use_the_correct_convex_interval() {
    let street = [p(0., 0.), p(10., 0.)];
    let ordinary = fit(p(5., 3.), street, 0.8);
    assert_eq!(ordinary.point, p(5., 0.));
    assert!((ordinary.half_cap_m - 0.4).abs() <= spacing(0.4));
    // v<h: each endpoint constraint has a bounded interval. Treating its
    // quadratic as the v>h half-line would admit contacts near either end.
    let near = fit(p(5., 0.1), street, 0.8);
    assert_eq!(near.point, p(5., 0.));
    assert!(near.feasible_interval_m[0] > 4. && near.feasible_interval_m[1] < 6.);
    assert!(scalar_margin(p(5., 0.1), street, 0.8, 1.)[0] < 0.);
    let other_side = fit(p(5., -0.1), street, 0.8);
    assert_eq!(near, other_side);
    assert_eq!(solve(p(-0.2, 0.1), street, 0.8), ContactOutcome::Empty);
}

#[test]
fn linear_and_tangent_constraints_keep_closed_contacts() {
    // v=h gives a linear inequality, not division by a nearly zero quadratic.
    let linear = fit(p(1., 1.), [p(0., 0.), p(4., 0.)], 2.);
    assert!((linear.distance_on_street_m - 1.).abs() < 1e-14);
    assert_eq!(
        solve(p(-1., 1.), [p(0., 0.), p(4., 0.)], 2.),
        ContactOutcome::Empty
    );

    // A street exactly one width long has a single feasible contact.
    let point = fit(p(1., 3.), [p(0., 0.), p(2., 0.)], 2.);
    assert_eq!(point.feasible_interval_m, [1., 1.]);
    assert_eq!(point.point, p(1., 0.));
    // Distance to endpoint A equals h (3-4-5): the quadratic has a double root.
    let tangent = fit(p(3., 4.), [p(0., 0.), p(20., 0.)], 10.);
    assert_eq!(
        tangent.feasible_interval_m[0],
        tangent.feasible_interval_m[1]
    );
    assert!((tangent.distance_on_street_m - 25. / 3.).abs() < 1e-12);
}

#[test]
fn rotation_and_city_coordinates_preserve_the_same_contact_without_snapping() {
    let entry = p(1.3, 19.037);
    let street = [
        p(3.273473033861575, 19.576274103331997),
        p(0.9373521978320412, 19.51884445330084),
    ];
    let angle = 327.2482579620229_f64.to_radians();
    let transform = |q: Point| {
        p(
            8508.882370282952 + libm::cos(angle) * q.x - libm::sin(angle) * q.y,
            7177.95894694146 + libm::sin(angle) * q.x + libm::cos(angle) * q.y,
        )
    };
    let local = fit(entry, street, 0.8);
    let world = fit(transform(entry), street.map(transform), 0.8);
    let expected = transform(local.point);
    assert!(libm::hypot(world.point.x - expected.x, world.point.y - expected.y) < 1e-9);
    assert!((world.distance_on_street_m - local.distance_on_street_m).abs() < 1e-9);
    // Large absolute coordinates are subtracted before the quadratic solve.
    let shift = |q: Point| p(q.x + 1_000_000., q.y - 2_000_000.);
    let far = fit(
        shift(p(5., 0.1)),
        [shift(p(0., 0.)), shift(p(10., 0.))],
        0.8,
    );
    assert_eq!(far.point, shift(p(5., 0.)));
}

#[test]
fn real_3537_world_point_passes_the_strict_cap_guard_with_only_representation_rounding() {
    let entry = p(8520.274717422595, 7193.266193449239);
    let street = [
        p(8522.226200087478, 7192.652086143825),
        p(8520.230400307586, 7193.867627983424),
    ];
    let value = fit(entry, street, 0.8);
    let [a, b] = street;
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let length = libm::hypot(dx, dy);
    let raw_s = value.feasible_interval_m[1];
    let raw_point = p(a.x + dx / length * raw_s, a.y + dy / length * raw_s);
    // This is a change in representation at city-coordinate precision, never
    // a chosen metric margin. At most one world-ULP norm plus scalar rounding.
    let max_step = libm::hypot(spacing(raw_point.x), spacing(raw_point.y)).max(spacing(raw_s))
        + spacing(raw_s);
    assert!(value.distance_on_street_m <= raw_s);
    assert!(raw_s - value.distance_on_street_m <= max_step);
    assert!((value.point.x - raw_point.x).abs() <= 2. * spacing(raw_point.x));
    assert!((value.point.y - raw_point.y).abs() <= 2. * spacing(raw_point.y));

    // The same strict world-point operations as the authoritative street cap:
    // neither endpoint receives a tolerance, even at an analytic equality.
    let (vx, vy) = (value.point.x - entry.x, value.point.y - entry.y);
    let connector = libm::hypot(vx, vy);
    let normal = [vy / connector, -vx / connector];
    let dot = (dx * normal[0] + dy * normal[1]) / length;
    let half = 0.4 / dot.abs();
    let from = ((value.point.x - a.x) * dx + (value.point.y - a.y) * dy) / length;
    assert!(
        from >= half && length - from >= half,
        "represented street cap outside: left={} right={}",
        from - half,
        length - from - half
    );
    assert!(
        scalar_margin(entry, street, 0.8, value.distance_on_street_m)
            .into_iter()
            .all(|margin| margin >= 0.)
    );
}

#[test]
fn short_segments_and_unsupported_degeneracies_are_explicit() {
    assert_eq!(
        solve(p(0.35, 1.), [p(0., 0.), p(0.7, 0.)], 0.8),
        ContactOutcome::Empty
    );
    for (entry, street, width) in [
        (p(2., 0.), [p(0., 0.), p(4., 0.)], 0.8),
        (p(2., 1.), [p(0., 0.), p(0., 0.)], 0.8),
        (p(2., 1.), [p(0., 0.), p(4., 0.)], 0.),
        (p(f64::NAN, 1.), [p(0., 0.), p(4., 0.)], 0.8),
        (p(2., 1.), [p(0., 0.), p(f64::INFINITY, 0.)], 0.8),
    ] {
        assert!(matches!(
            solve(entry, street, width),
            ContactOutcome::Unsupported(_)
        ));
    }
}
