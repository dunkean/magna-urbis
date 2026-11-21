//! Segment intersections, corridor cleanup, and the shape of dead ends.

use super::street;
use super::super::analysis::{Graph, dead_ends};
use super::super::ends::square_ends;
use super::super::junctions::clean;
use super::super::parallel::drop_narrow_doubles;
use super::super::spatial::{Segment, candidates, crossings, distance, key};
use crate::urban::Point;

#[test]
fn spatial_buckets_keep_every_exact_intersection() {
    let mut rng = crate::rng::Rng::new("urban-intersection-buckets");
    let mut segments: Vec<_> = (0..80)
        .map(|street| Segment {
            street,
            offset: 0,
            a: Point {
                x: rng.range(-200.0, 200.0),
                y: rng.range(-200.0, 200.0),
            },
            b: Point {
                x: rng.range(-200.0, 200.0),
                y: rng.range(-200.0, 200.0),
            },
        })
        .collect();
    // These cross exactly at a bucket corner, from opposite diagonals.
    segments.push(Segment {
        street: 80,
        offset: 0,
        a: Point { x: -60.0, y: -60.0 },
        b: Point { x: 60.0, y: 60.0 },
    });
    segments.push(Segment {
        street: 81,
        offset: 0,
        a: Point { x: -60.0, y: 60.0 },
        b: Point { x: 60.0, y: -60.0 },
    });
    let pairs = candidates(&segments, 30.0);
    for i in 0..segments.len() {
        for j in i + 1..segments.len() {
            if !crossings(segments[i], segments[j]).is_empty() {
                assert!(pairs.contains(&(i, j)), "missing crossing {i}/{j}");
            }
        }
    }
}

#[test]
fn spatial_buckets_cross_boundaries_for_sub_epsilon_coordinate_steps() {
    for reverse in [false, true] { for swap in [false, true] {
        let point = |x, y| if swap { Point { x: y, y: x } } else { Point { x, y } };
        let (a, b) = (point(60.0 - 1e-14, 0.0), point(60.0, 100.0));
        let (a, b) = if reverse { (b, a) } else { (a, b) };
        let segments = [Segment { street: 0, offset: 0, a, b }, Segment {
            street: 1, offset: 0, a: point(59.0, 50.0), b: point(61.0, 50.0),
        }];
        assert!(candidates(&segments, 60.0).contains(&(0, 1)));
    }}
}

#[test]
fn crossings_are_shared_junctions_and_orphans_are_removed() {
    let mut streets = vec![
        street(&[(-100.0, 0.0), (100.0, 0.0)], "regional"),
        street(&[(0.0, -50.0), (0.0, 50.0)], "street"),
        street(&[(30.0, 30.0), (60.0, 30.0)], "street"),
    ];
    let warnings = clean(&mut streets, Point { x: 0.0, y: 0.0 }, 100.0, true);
    assert_eq!(streets.len(), 2);
    assert_eq!(warnings.len(), 1);
    assert!(
        streets
            .iter()
            .all(|s| s.path.iter().any(|&p| key(p) == (0, 0)))
    );
    assert_eq!(Graph::new(&streets).degree(Point { x: 0.0, y: 0.0 }), 4);
}

#[test]
fn a_copy_inside_a_wider_corridor_is_removed_and_its_side_street_reattached() {
    // The 01-l bridge approach: a 14 m street with a lane copy 2-3 m off
    // its centreline, a side street meeting the copy only.
    let mut main = street(&[(-100.0, 0.0), (0.0, 0.0), (100.0, 0.0)], "street");
    main.rank = 1;
    main.widths = vec![14.0; 3];
    let copy = street(&[(-60.0, 2.0), (-10.0, 3.0), (40.0, 2.5)], "lane");
    let side = street(&[(-10.0, 3.0), (-10.0, 80.0)], "street");
    let mut streets = vec![
        street(&[(-200.0, 0.0), (-100.0, 0.0)], "regional"),
        main,
        copy,
        side,
        street(&[(100.0, 0.0), (200.0, 0.0)], "regional"),
    ];
    clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
    assert!(!streets.iter().any(|s| s.role == "lane"), "{streets:?}");
    let side = streets
        .iter()
        .find(|s| {
            s.path
                .iter()
                .any(|p| key(*p) == key(Point { x: -10.0, y: 80.0 }))
        })
        .expect("side street kept");
    let joint = side.path[0];
    assert!(
        joint.y.abs() < 1e-6 && (joint.x + 10.0).abs() < 1e-6,
        "{joint:?}"
    );
    assert_eq!(Graph::new(&streets).degree(joint), 3);
    // A parallel street beyond the corridor's ribbon is a real street.
    let mut streets = vec![
        street(&[(-100.0, 0.0), (100.0, 0.0)], "regional"),
        street(
            &[(-100.0, 0.0), (-100.0, 12.0), (100.0, 12.0), (100.0, 0.0)],
            "street",
        ),
    ];
    clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
    assert_eq!(streets.len(), 2);
}

#[test]
fn short_spurs_go_and_loose_ends_a_gap_apart_are_joined() {
    // A 4 m spur hangs off a 7 m street: it serves no lot.
    let mut main = street(
        &[(-100.0, 0.0), (0.0, 0.0), (10.0, -10.0), (-6.0, -10.0)],
        "street",
    );
    main.widths = vec![7.0; main.path.len()];
    let mut streets = vec![
        street(&[(-200.0, 0.0), (-100.0, 0.0)], "regional"),
        main,
        street(&[(10.0, -10.0), (12.0, -13.0)], "street"),
    ];
    clean(&mut streets, Point { x: -100.0, y: 0.0 }, 400.0, true);
    assert_eq!(streets.len(), 2);
    assert!(!streets.iter().any(|s| {
        s.path
            .iter()
            .any(|p| key(*p) == key(Point { x: 12.0, y: -13.0 }))
    }));
    // The street's own hook stays: its loose end may bound blocks.
    assert!(streets.iter().any(|s| {
        s.path
            .iter()
            .any(|p| key(*p) == key(Point { x: -6.0, y: -10.0 }))
    }));
    // Two loose ends 6 m apart (the 04 lattice gap) are one street.
    let mut streets = vec![
        street(&[(-200.0, 0.0), (0.0, 0.0)], "regional"),
        street(&[(0.0, 0.0), (0.0, 60.0), (40.0, 60.0)], "street"),
        street(&[(46.0, 60.0), (46.0, 0.0), (0.0, 0.0)], "street"),
    ];
    clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
    let graph = Graph::new(&streets);
    assert!(streets.iter().all(|s| {
        s.path
            .iter()
            .all(|&p| graph.degree(p) >= 2 || s.role == "regional")
    }));
    // The 01-l bridge approach stopping 0.5 m short of a lane is joined.
    let mut streets = vec![
        street(&[(-200.0, 0.0), (0.0, 0.0)], "regional"),
        street(&[(0.0, 0.0), (0.0, 60.0)], "street"),
        street(
            &[(-100.0, 0.0), (-100.0, 60.5), (100.0, 60.5), (100.0, 0.0)],
            "lane",
        ),
        street(&[(100.0, 0.0), (200.0, 0.0)], "regional"),
    ];
    clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
    assert_eq!(Graph::new(&streets).degree(Point { x: 0.0, y: 60.5 }), 3);
}

#[test]
fn open_fringe_gets_served_short_ends_but_closes_and_regional_stay() {
    let mut streets = vec![
        street(&[(-100.0, 0.0), (100.0, 0.0)], "regional"),
        street(&[(0.0, 0.0), (0.0, 100.0)], "street"),
        street(&[(30.0, 0.0), (30.0, 90.0)], "close"),
    ];
    clean(&mut streets, Point { x: 0.0, y: 0.0 }, 100.0, false);
    let spur = streets.iter().find(|s| s.role == "street").unwrap();
    assert_eq!(spur.path.last().unwrap().y, 15.0);
    assert!(spur.widths.last().unwrap() < &spur.widths[0]);
    assert_eq!(
        streets
            .iter()
            .find(|s| s.role == "close")
            .unwrap()
            .path
            .last()
            .unwrap()
            .y,
        90.0
    );
    assert_eq!(
        streets
            .iter()
            .find(|s| s.role == "regional")
            .unwrap()
            .path
            .last()
            .unwrap()
            .x,
        100.0
    );
}

#[test]
fn collinear_overlap_is_not_a_doubled_road() {
    let mut streets = vec![
        street(&[(0.0, 0.0), (100.0, 0.0)], "regional"),
        street(&[(40.0, 0.0), (140.0, 0.0)], "street"),
    ];
    clean(&mut streets, Point { x: 50.0, y: 0.0 }, 200.0, true);
    let length: f64 = streets
        .iter()
        .flat_map(|s| s.path.windows(2))
        .map(|p| distance(p[0], p[1]))
        .sum();
    assert!((length - 140.0).abs() < 1e-8);
    assert_eq!(Graph::new(&streets).length.len(), 1);
}

/// A dead end whose last segment is shorter than its half width ends
/// square: no land past the line square to that segment through the end
/// (the joint's round would bite a notch into the block ahead), while a
/// street end on a junction keeps its ribbon.
#[test]
fn dead_end_ribbons_end_square() {
    use crate::urban::geometry as g;
    let mut streets = vec![
        street(&[(0.0, 0.0), (50.0, 0.0), (51.0, 0.0)], "street"),
        street(&[(0.0, -20.0), (0.0, 0.0), (0.0, 20.0)], "street"),
    ];
    for s in &mut streets {
        s.widths = vec![8.0; s.path.len()];
    }
    let dead = dead_ends(&streets);
    assert_eq!(dead, vec![[false, true], [true, true]]);
    let s = &streets[0];
    let raw = g::ribbon(&s.path, &s.widths);
    let past = |pieces: &[crate::urban::Shape]| {
        pieces
            .iter()
            .flat_map(|p| p.outer.iter())
            .map(|p| p.x)
            .fold(f64::NEG_INFINITY, f64::max)
    };
    assert!(past(&raw) > 53.0, "the joint bulges past the end");
    let square = square_ends(raw, &s.path, &s.widths, dead[0]);
    assert!(past(&square) <= 51.0 + 1e-6);
    // The start, on the cross street, is not a dead end: untouched.
    let start = square
        .iter()
        .flat_map(|p| p.outer.iter())
        .map(|p| p.x)
        .fold(f64::INFINITY, f64::min);
    assert!(start.abs() < 1e-6);
}

/// A lane running 2.5 m from a street's ribbon leaves a strip no lot
/// fits: it is removed. The same lane 8 m away, or with a curtain
/// between the two, stays.
#[test]
fn a_lane_leaving_a_sliver_beside_a_street_is_removed() {
    let pair = |gap: f64| {
        let mut main = street(&[(0.0, 0.0), (100.0, 0.0)], "street");
        main.rank = 1;
        main.widths = vec![4.0; 2];
        let y = 2.0 + 1.5 + gap;
        let mut lane = street(&[(5.0, y), (95.0, y)], "lane");
        lane.rank = 3;
        lane.widths = vec![3.0; 2];
        vec![main, lane]
    };
    let mut streets = pair(2.5);
    assert!(drop_narrow_doubles(&mut streets, &[], 200.0));
    assert!(streets.iter().all(|s| s.role != "lane"));
    let mut streets = pair(8.0);
    assert!(!drop_narrow_doubles(&mut streets, &[], 200.0));
    let wall = crate::urban::Enclosure {
        path: [
            (-10.0, 3.0),
            (110.0, 3.0),
            (110.0, 50.0),
            (-10.0, 50.0),
            (-10.0, 3.0),
        ]
        .iter()
        .map(|&(x, y)| Point { x, y })
        .collect(),
        kind: "wall".into(),
        ..Default::default()
    };
    let mut streets = pair(2.5);
    assert!(!drop_narrow_doubles(&mut streets, &[wall], 200.0));
    assert_eq!(streets.len(), 2);
}
