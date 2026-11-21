use super::*;
use crate::graph::{EdgeSpec, End, Key, Level, NodeKind};
use magna_urbis_geom::{area, difference, intersection, rectangle, ribbon, simple};

fn pt(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn polygon(corners: &[(f64, f64)]) -> Shape {
    Shape {
        outer: corners.iter().map(|&(x, y)| pt(x, y)).collect(),
        holes: vec![],
    }
}

fn street(points: &[(f64, f64)], widths: &[f64], side: Side) -> BoundaryEdge {
    BoundaryEdge {
        polyline: points.iter().map(|&(x, y)| pt(x, y)).collect(),
        widths: widths.to_vec(),
        class: EdgeClass::Street,
        side,
    }
}

/// One street of `width` per side of a counter-clockwise polygon, the block on the left.
fn ring_streets(corners: &[(f64, f64)], width: f64) -> Vec<BoundaryEdge> {
    let n = corners.len();
    (0..n)
        .map(|i| street(&[corners[i], corners[(i + 1) % n]], &[width, width], Side::Left))
        .collect()
}

fn total(pieces: &[Shape]) -> f64 {
    pieces.iter().map(area).sum()
}

/// Every piece is simple, lies inside the face and clear of every street's ribbon and every
/// carved shape (up to the snapping tolerances).
fn assert_sound(pieces: &[Shape], face: &Shape, boundary: &[BoundaryEdge], carved: &[Shape]) {
    for p in pieces {
        assert!(simple(p), "piece is not simple: {p:?}");
        let outside: f64 = difference(p, face).iter().map(area).sum();
        assert!(outside < 0.5, "{outside} m² outside the face");
        for e in boundary {
            let overlap: f64 = ribbon(&e.polyline, &e.widths)
                .iter()
                .flat_map(|r| intersection(p, r))
                .map(|s| area(&s))
                .sum();
            assert!(overlap < 0.5, "{overlap} m² on the street {:?}", e.polyline);
        }
        for c in carved {
            let overlap: f64 = intersection(p, c).iter().map(area).sum();
            assert!(overlap < 0.5, "{overlap} m² on a carved shape");
        }
    }
}

const SQUARE: [(f64, f64); 4] = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)];

#[test]
fn a_square_with_four_streets_keeps_its_inner_square() {
    let face = polygon(&SQUARE);
    let boundary = ring_streets(&SQUARE, 6.0);
    let pieces = buildable(&face, &boundary, &[]);
    assert_sound(&pieces, &face, &boundary, &[]);
    assert_eq!(pieces.len(), 1);
    assert!((total(&pieces) - 94.0 * 94.0).abs() < 1.0, "{}", total(&pieces));
    assert_eq!(pieces[0].outer.len(), 4, "{:?}", pieces[0].outer);

    // A reserve carved in a corner takes its land too.
    let carved = [rectangle(0.0, 0.0, 30.0, 30.0)];
    let pieces = buildable(&face, &boundary, &carved);
    assert_sound(&pieces, &face, &boundary, &carved);
    assert_eq!(pieces.len(), 1);
    assert!((total(&pieces) - (94.0 * 94.0 - 27.0 * 27.0)).abs() < 1.0);
}

#[test]
fn a_ten_degree_corner_leaves_a_blunt_inner_triangle() {
    let tip = 10f64.to_radians();
    let corners = [
        (0.0, 0.0),
        (200.0, 0.0),
        (200.0 * tip.cos(), 200.0 * tip.sin()),
    ];
    let face = polygon(&corners);
    let boundary = ring_streets(&corners, 6.0);
    let pieces = buildable(&face, &boundary, &[]);
    assert_sound(&pieces, &face, &boundary, &[]);
    assert_eq!(pieces.len(), 1);
    // The inner offset triangle (about 2,290 m²) less its tip narrower than 4 m.
    let a = total(&pieces);
    assert!((2150.0..2300.0).contains(&a), "{a}");
    // The offset lines meet 3 / sin 5° ≈ 34 m from the corner; the opened tip lies further.
    let near = pieces[0]
        .outer
        .iter()
        .map(|p| p.distance(pt(0.0, 0.0)))
        .fold(f64::INFINITY, f64::min);
    assert!(near > 40.0, "{near}");
}

#[test]
fn a_half_metre_edge_between_two_streets_changes_nothing_inside() {
    let cut = 0.5 / 2f64.sqrt();
    let corners = [
        (0.0, 0.0),
        (100.0, 0.0),
        (100.0, 100.0 - cut),
        (100.0 - cut, 100.0),
        (0.0, 100.0),
    ];
    let face = polygon(&corners);
    let boundary = ring_streets(&corners, 6.0);
    let pieces = buildable(&face, &boundary, &[]);
    assert_sound(&pieces, &face, &boundary, &[]);
    assert_eq!(pieces.len(), 1);
    // The short edge's offset passes 4 m from the inner corner, which stays square.
    assert!((total(&pieces) - 94.0 * 94.0).abs() < 1.0, "{}", total(&pieces));
}

#[test]
fn a_face_narrower_than_its_streets_vanishes_and_a_neck_splits() {
    let strip = [(0.0, 0.0), (100.0, 0.0), (100.0, 5.0), (0.0, 5.0)];
    let pieces = buildable(&polygon(&strip), &ring_streets(&strip, 6.0), &[]);
    assert!(pieces.is_empty(), "{pieces:?}");

    // Two 40 m squares joined by a 6 m neck: the neck's streets take all of it.
    let dumbbell = [
        (0.0, 0.0),
        (40.0, 0.0),
        (40.0, 17.0),
        (60.0, 17.0),
        (60.0, 0.0),
        (100.0, 0.0),
        (100.0, 40.0),
        (60.0, 40.0),
        (60.0, 23.0),
        (40.0, 23.0),
        (40.0, 40.0),
        (0.0, 40.0),
    ];
    let face = polygon(&dumbbell);
    let boundary = ring_streets(&dumbbell, 6.0);
    let pieces = buildable(&face, &boundary, &[]);
    assert_sound(&pieces, &face, &boundary, &[]);
    assert_eq!(pieces.len(), 2, "{pieces:?}");
    for p in &pieces {
        assert!((area(p) - 34.0 * 34.0).abs() < 1.0, "{}", area(p));
    }
}

#[test]
fn a_dangling_cul_de_sac_cuts_a_square_ended_slot() {
    let face = polygon(&SQUARE);
    let boundary = vec![
        street(&[(0.0, 0.0), (50.0, 0.0)], &[6.0, 6.0], Side::Left),
        street(&[(50.0, 0.0), (100.0, 0.0)], &[6.0, 6.0], Side::Left),
        street(&[(100.0, 0.0), (100.0, 100.0)], &[6.0, 6.0], Side::Left),
        street(&[(100.0, 100.0), (0.0, 100.0)], &[6.0, 6.0], Side::Left),
        street(&[(0.0, 100.0), (0.0, 0.0)], &[6.0, 6.0], Side::Left),
        street(&[(50.0, 0.0), (50.0, 60.0)], &[6.0, 6.0], Side::Both),
    ];
    let pieces = buildable(&face, &boundary, &[]);
    assert_sound(&pieces, &face, &boundary, &[]);
    assert_eq!(pieces.len(), 1);
    // The slot is 6 m wide from the bottom street's edge (y = 3) to the dead end (y = 60).
    let expected = 94.0 * 94.0 - 6.0 * 57.0;
    assert!((total(&pieces) - expected).abs() < 1.0, "{}", total(&pieces));
    let top = pieces[0]
        .outer
        .iter()
        .filter(|p| (p.x - 50.0).abs() < 3.5)
        .map(|p| p.y)
        .fold(f64::NEG_INFINITY, f64::max);
    assert!((top - 60.0).abs() < 0.1, "slot ends at {top}");
}

#[test]
fn varying_widths_follow_their_profile() {
    let face = polygon(&SQUARE);
    let mut boundary = ring_streets(&SQUARE, 6.0);
    // The bottom street widens from 4 m to 12 m through a middle vertex.
    boundary[0] = street(
        &[(0.0, 0.0), (50.0, 0.0), (100.0, 0.0)],
        &[4.0, 8.0, 12.0],
        Side::Left,
    );
    let pieces = buildable(&face, &boundary, &[]);
    assert_sound(&pieces, &face, &boundary, &[]);
    assert_eq!(pieces.len(), 1);
    // Above the line y = 2 + 0.04 x, between x = 3 and x = 97, below y = 97.
    let expected = 95.0 * 94.0 - 0.02 * (97.0 * 97.0 - 3.0 * 3.0);
    assert!((total(&pieces) - expected).abs() < 1.0, "{}", total(&pieces));
    for p in pieces[0].outer.iter().filter(|p| p.y < 10.0) {
        assert!((p.y - (2.0 + 0.04 * p.x)).abs() < 0.05, "{p:?} off the profile");
    }
}

#[test]
fn a_hole_grows_by_its_streets() {
    let hole = [(40.0, 40.0), (60.0, 40.0), (60.0, 60.0), (40.0, 60.0)];
    let mut face = polygon(&SQUARE);
    face.holes.push(polygon(&hole).outer);
    let mut boundary = ring_streets(&SQUARE, 6.0);
    // The hole's ring runs counter-clockwise: the block lies on its right.
    boundary.extend(ring_streets(&hole, 6.0).into_iter().map(|mut e| {
        e.side = Side::Right;
        e
    }));
    let pieces = buildable(&face, &boundary, &[]);
    assert_sound(&pieces, &face, &boundary, &[]);
    assert_eq!(pieces.len(), 1);
    assert_eq!(pieces[0].holes.len(), 1);
    // Square corners around the hole: the miters reach 26 m by 26 m.
    let expected = 94.0 * 94.0 - 26.0 * 26.0;
    assert!((total(&pieces) - expected).abs() < 1.0, "{}", total(&pieces));
}

#[test]
fn from_graph_reads_the_walks_of_a_face_and_its_dead_end() {
    let mut g = Graph::new(50.0);
    let event = Key::event(0, &[0]);
    let nodes: Vec<_> = SQUARE
        .iter()
        .enumerate()
        .map(|(i, &(x, y))| {
            g.add_node(
                Key::node(&[i as u32]),
                Level::Ground,
                pt(x, y),
                NodeKind::Junction,
                Clock::ZERO,
            )
            .unwrap()
        })
        .collect();
    let mut sides = Vec::new();
    for i in 0..4 {
        let j = (i + 1) % 4;
        let spec = EdgeSpec::new(
            Key::edge(&event, i as u32),
            Level::Ground,
            EdgeClass::Street,
            vec![pt(SQUARE[i].0, SQUARE[i].1), pt(SQUARE[j].0, SQUARE[j].1)],
            4.0,
        );
        let change = g
            .insert_edge(spec, [End::Node(nodes[i]), End::Node(nodes[j])], Clock::ZERO)
            .unwrap();
        sides.push(change.born.edges[0]);
    }
    let bounded = |g: &Graph| -> Vec<FaceId> {
        g.live_faces()
            .filter(|&f| g.face(f).outer.is_some())
            .collect()
    };
    let spec = BlockSpec::default();
    let faces = bounded(&g);
    assert_eq!(faces.len(), 1);
    let pieces = from_graph(&g, faces[0], Clock::ZERO, &spec);
    assert_eq!(pieces.len(), 1);
    assert!((total(&pieces) - 96.0 * 96.0).abs() < 1.0, "{}", total(&pieces));
    assert!(from_graph(&g, g.outside(Level::Ground), Clock::ZERO, &spec).is_empty());

    // A cul-de-sac from the bottom street, 60 m long and 4 m wide.
    let spec_edge = EdgeSpec::new(
        Key::edge(&event, 4),
        Level::Ground,
        EdgeClass::Street,
        vec![pt(50.0, 0.0), pt(50.0, 60.0)],
        4.0,
    );
    g.insert_edge(
        spec_edge,
        [
            End::OnEdge {
                edge: sides[0],
                kind: NodeKind::Junction,
            },
            End::Free {
                kind: NodeKind::DeadEnd,
            },
        ],
        Clock(1),
    )
    .unwrap();
    let faces = bounded(&g);
    assert_eq!(faces.len(), 1);
    let pieces = from_graph(&g, faces[0], Clock(1), &spec);
    assert_eq!(pieces.len(), 1);
    let expected = 96.0 * 96.0 - 4.0 * 58.0;
    assert!((total(&pieces) - expected).abs() < 1.0, "{}", total(&pieces));
}
