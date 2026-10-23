//! Analytical characterization only. This does not change any admission path.
//! Register under cfg(test) when the physical-domain contract is integrated.
use crate::geometry::{difference, rectangle, unite};
use crate::model::Point;
use crate::placement::ArchitectureTerrain;

#[test]
fn bare_court_is_not_a_level_foundation_but_an_actual_outer_support_is() {
    let terrain = ArchitectureTerrain {
        origin: Point { x: 0., y: 0. },
        ground_z_m: 0.,
        gradient: [0., 0.1],
        water_z_m: None,
        max_foundation_step_m: 0.75,
        grid: None,
    };
    let body = rectangle(0., 0., 4., 4.);
    let bare_court = rectangle(0., 4., 4., 8.);
    let bare_path = rectangle(4., 0., 1.25, 12.);
    // The actual lateral gallery used by side_corridor occupies the body
    // depth, not every metre of the bare path beyond it.
    let gallery = rectangle(4., 0., 0.85, 4.);
    let bearing = unite(&[body.clone(), gallery.clone()]);
    let rights = unite(&[bearing.clone(), bare_court, bare_path]);
    let step = |surface| {
        let (lo, hi, slope) = terrain.foundation_bounds(surface).unwrap();
        assert!(slope < crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG);
        hi - lo
    };
    assert!((step(&rights) - 1.2).abs() < 1e-9);
    assert!((step(&bearing) - 0.4).abs() < 1e-9);
    assert!(step(&bearing) <= terrain.max_foundation_step_m);
    assert!(step(&rights) > terrain.max_foundation_step_m);

    // A real post on the far side of the same courtyard changes the answer.
    // Removing courts from the bearing domain must not remove its support.
    let far_post = rectangle(1., 10., 0.2, 0.2);
    let with_post = unite(&[bearing.clone(), far_post]);
    assert!((step(&with_post) - 1.02).abs() < 1e-9);
    assert!(step(&with_post) > terrain.max_foundation_step_m);

    // Likewise, a real enclosing ring follows its declared lot. It cannot be
    // omitted merely because its centre is an unbuilt courtyard.
    let enclosure = difference(
        &rectangle(-1., -1., 7., 14.),
        &rectangle(-0.8, -0.8, 6.6, 13.6),
    );
    assert!(step(&unite(&[bearing, enclosure.clone()])) > terrain.max_foundation_step_m);
    assert!(crate::geometry::area(&difference(&enclosure, &rights)) > 0.1);
}
