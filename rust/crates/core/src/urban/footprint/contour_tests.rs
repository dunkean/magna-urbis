//! Growth contours preserve buildable land, components and water holes.
use super::{Grid, area, distance, dry, smooth_growth};
use crate::rng::Rng;
use crate::urban::{Point, Shape, Surface, geography, geometry as g};
use geo::Validation;

#[test]
fn seeded_growth_contours_remove_lattice_stairs_instead_of_only_rounding_corners() {
    let grid = Grid {
        x0: 0.0,
        y0: 0.0,
        step: 10.0,
        nx: 64,
        ny: 64,
    };
    let noise = crate::noise::Noise::new(Rng::new("decor-70-smooth-growth"));
    let mask: Vec<_> = (0..grid.nx * grid.ny)
        .map(|i| {
            let p = grid.point(i);
            let radius = 170.0 + 12.0 * noise.noise(p.x / 90.0, p.y / 90.0);
            (p.x - 320.0).hypot((p.y - 320.0) * 1.3) < radius
        })
        .collect();
    let h = vec![0.0; 64 * 64];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 640.0,
        n: 64,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let raw = grid.contours(&mask);
    let anchors = grid.boundary_centers(&mask);
    let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
    assert_eq!(smooth.len(), 1);
    let ring = &smooth[0].outer;
    let mut axial = 0.0;
    let mut perimeter = 0.0;
    let mut max_turn = 0.0_f64;
    for i in 0..ring.len() {
        let a = ring[(i + ring.len() - 1) % ring.len()];
        let b = ring[i];
        let c = ring[(i + 1) % ring.len()];
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let (ex, ey) = (c.x - b.x, c.y - b.y);
        max_turn = max_turn.max((dx * ey - dy * ex).atan2(dx * ex + dy * ey).abs());
    }
    assert!(max_turn < 0.6, "abrupt raster corner: {} radians", max_turn);
    for (&a, &b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let length = distance(a, b);
        perimeter += length;
        if (a.x - b.x).abs().min((a.y - b.y).abs()) < length * 0.02 {
            axial += length;
        }
    }
    assert!(
        axial / perimeter < 0.25,
        "lattice-aligned perimeter: {}",
        axial / perimeter
    );
    assert!((area(&smooth) - area(&raw)).abs() < area(&raw) * 0.01);
    assert!(anchors.iter().all(|&p| g::contains(&smooth[0], p)));
    assert_eq!(
        serde_json::to_string(&smooth).unwrap(),
        serde_json::to_string(&smooth_growth(&raw, grid.step, surface, &anchors)).unwrap()
    );
}

/// Consecutive axis-parallel right angles a growth cell or two apart: the
/// lattice staircase (isolated box corners do not count).
fn lattice_stairs(shapes: &[Shape], step: f64) -> usize {
    let mut count = 0;
    for r in shapes
        .iter()
        .flat_map(|s| std::iter::once(&s.outer).chain(&s.holes))
    {
        let k = r.len();
        let right = |i: usize| {
            let (a, b, c) = (r[(i + k - 1) % k], r[i], r[(i + 1) % k]);
            let axial =
                |p: Point, q: Point| (p.x - q.x).abs() < 1e-6 || (p.y - q.y).abs() < 1e-6;
            axial(a, b) && axial(b, c)
        };
        count += (0..k)
            .filter(|&i| {
                right(i) && right((i + 1) % k) && distance(r[i], r[(i + 1) % k]) < step * 2.5
            })
            .count();
    }
    count
}

/// A three-cell faubourg arm grown along a diagonal road (P29, P30): its
/// rounded staircase moves a sixth of its area while every boundary cell
/// centre stays, so an area cap must not restore its whole staircase.
#[test]
fn a_narrow_diagonal_arm_loses_its_lattice_staircase() {
    let grid = Grid {
        x0: 0.0,
        y0: 0.0,
        step: 10.0,
        nx: 64,
        ny: 64,
    };
    let mask: Vec<_> = (0..grid.nx * grid.ny)
        .map(|i| {
            let (x, y) = ((i % grid.nx) as i64, (i / grid.nx) as i64);
            (x - y).abs() <= 1 && (8..56).contains(&x)
        })
        .collect();
    let h = vec![0.0; 64 * 64];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 640.0,
        n: 64,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let raw = grid.contours(&mask);
    let anchors = grid.boundary_centers(&mask);
    let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
    assert_eq!(smooth.len(), 1);
    assert!(lattice_stairs(&raw, grid.step) > 80);
    assert_eq!(
        lattice_stairs(&smooth, grid.step),
        0,
        "arm kept its staircase"
    );
    assert!((area(&smooth) - area(&raw)).abs() < area(&raw) * 0.02);
    assert!(anchors.iter().all(|&p| g::contains(&smooth[0], p)));
}

/// A thin river hugging the inner corner of an L-shaped town (P29): the
/// rounded corner crosses it and leaves dry crumbs on the far bank, far
/// below a growth cell. They are dropped; they must not restore the
/// staircase of the whole outline.
#[test]
fn dry_crumbs_across_a_river_do_not_restore_the_lattice() {
    let grid = Grid {
        x0: 0.0,
        y0: 0.0,
        step: 10.0,
        nx: 64,
        ny: 64,
    };
    let mask: Vec<_> = (0..grid.nx * grid.ny)
        .map(|i| {
            let (x, y) = (i % grid.nx, i / grid.nx);
            ((10..30).contains(&x) && (10..50).contains(&y)
                || (10..50).contains(&x) && (10..30).contains(&y))
                && x + y >= 30
        })
        .collect();
    let n = 512;
    let cell = 640.0 / n as f64;
    let water: Vec<u8> = (0..n * n)
        .map(|i| {
            let (x, y) = (
                (i % n) as f64 * cell + cell * 0.5,
                (i / n) as f64 * cell + cell * 0.5,
            );
            u8::from(x > 300.0 && y > 300.0 && (x - 300.0).min(y - 300.0) < cell)
        })
        .collect();
    let h = vec![0.0; n * n];
    let raster = Surface {
        geometry: None,
        width: 640.0,
        n,
        height: &h,
        water: &water,
        interpolation: Default::default(),
    };
    let shoreline = geography::raster_shoreline(&raster).unwrap();
    let surface = shoreline.surface(raster);
    let raw = dry(surface, &grid.contours(&mask));
    let anchors: Vec<_> = grid
        .boundary_centers(&mask)
        .into_iter()
        .filter(|&p| raw.iter().any(|s| g::contains(s, p)))
        .collect();
    let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
    assert_eq!(smooth.len(), 1);
    assert!(lattice_stairs(&raw, grid.step) > 15);
    assert_eq!(
        lattice_stairs(&smooth, grid.step),
        0,
        "river crumbs restored the staircase"
    );
    assert!(anchors.iter().all(|&p| g::contains(&smooth[0], p)));
}

#[test]
fn small_growth_components_keep_their_area_without_restoring_lattice_steps() {
    let grid = Grid {
        x0: 0.0,
        y0: 0.0,
        step: 10.0,
        nx: 64,
        ny: 64,
    };
    let mask: Vec<_> = (0..grid.nx * grid.ny)
        .map(|i| {
            let p = grid.point(i);
            (p.x - 150.0).hypot((p.y - 150.0) * 1.3) < 65.0
                || (p.x - 410.0).hypot((p.y - 410.0) * 1.3) < 80.0
        })
        .collect();
    let h = vec![0.0; 64 * 64];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 640.0,
        n: 64,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let raw = grid.contours(&mask);
    let anchors = grid.boundary_centers(&mask);
    let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
    assert_eq!(smooth.len(), 2);
    for shape in &smooth {
        let mut axial = 0.0;
        let mut perimeter = 0.0;
        for (&a, &b) in shape
            .outer
            .iter()
            .zip(shape.outer.iter().cycle().skip(1))
            .take(shape.outer.len())
        {
            let length = distance(a, b);
            perimeter += length;
            if (a.x - b.x).abs().min((a.y - b.y).abs()) < length * 0.02 {
                axial += length;
            }
        }
        assert!(
            axial / perimeter < 0.25,
            "small district reverted to the lattice: {}",
            axial / perimeter
        );
    }
    assert!((area(&smooth) - area(&raw)).abs() < area(&raw) * 0.01);
    assert!(
        anchors
            .iter()
            .all(|&p| smooth.iter().any(|s| g::contains(s, p)))
    );
}

#[test]
fn smoothing_retains_thin_branches_components_centers_and_exact_water_holes() {
    let grid = Grid {
        x0: 0.0,
        y0: 0.0,
        step: 10.0,
        nx: 64,
        ny: 64,
    };
    let mut mask = vec![false; grid.nx * grid.ny];
    for y in 0..grid.ny {
        for x in 0..grid.nx {
            let circle = (x as f64 - 24.0).hypot(y as f64 - 30.0) < 15.0;
            let neck_and_arm =
                ((24..=57).contains(&x) && y == 30) || (x >= 53 && (25..=35).contains(&y));
            let island = (x as f64 - 8.0).hypot(y as f64 - 8.0) < 4.0;
            mask[y * grid.nx + x] = circle || neck_and_arm || island;
        }
    }
    let h = vec![0.0; 64 * 64];
    let mut w = vec![0; h.len()];
    for y in 27..=29 {
        for x in 22..=24 {
            w[y * 64 + x] = 1;
        }
    }
    let surface = Surface {
        geometry: None,
        width: 640.0,
        n: 64,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let raw = dry(surface, &grid.contours(&mask));
    let anchors = grid.boundary_centers(&mask);
    let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
    assert_eq!(raw.len(), smooth.len());
    assert_eq!(
        raw.iter().map(|s| s.holes.len()).sum::<usize>(),
        smooth.iter().map(|s| s.holes.len()).sum::<usize>()
    );
    assert!((area(&smooth) - area(&raw)).abs() < area(&raw) * 0.01);
    for p in anchors
        .iter()
        .filter(|&&p| raw.iter().any(|s| g::contains(s, p)))
    {
        assert!(
            smooth.iter().any(|s| g::contains(s, *p)),
            "a one-cell arm was removed"
        );
    }
    assert!(
        !smooth
            .iter()
            .any(|s| g::contains(s, Point { x: 235.0, y: 285.0 }))
    );
    assert!(smooth.iter().all(|s| g::polygon(s).is_valid()));
    assert_ne!(
        serde_json::to_string(&raw).unwrap(),
        serde_json::to_string(&smooth).unwrap()
    );
    // Terrain clipping may leave a component smaller than the growth cell.
    let sliver = vec![g::rectangle(100.0, 100.0, 100.2, 100.3)];
    let retained = smooth_growth(&sliver, grid.step, surface, &[]);
    assert_eq!(retained.len(), 1);
    assert!((area(&retained) - area(&sliver)).abs() < 1.0e-6);
}
