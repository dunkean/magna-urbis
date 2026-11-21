use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::TAU;

use magna_urbis_geom::{Point, signed};

use super::*;

/// A small deterministic generator (SplitMix64), enough to draw and shuffle test cases.
struct Rng(u64);

impl Rng {
    fn new(label: &str) -> Self {
        Self(label.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)))
    }

    fn fork(&self, label: &str) -> Self {
        let mut child = Self::new(label);
        child.0 ^= self.0;
        child
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A uniform integer in `a..=b`.
    fn int(&mut self, a: u32, b: u32) -> u32 {
        a + (self.next() % (u64::from(b - a) + 1)) as u32
    }
}

fn pt(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn event(i: u32) -> Key {
    Key::event(0, &[i])
}

fn street(key: Key, polyline: Vec<Point>) -> EdgeSpec {
    EdgeSpec::new(key, Level::Ground, EdgeClass::Street, polyline, 4.0)
}

fn assert_sound(g: &Graph) {
    let violations = g.check_invariants();
    assert!(violations.is_empty(), "{violations:#?}");
}

fn area(g: &Graph, face: FaceId) -> f64 {
    let shape = g.outline(face).expect("bounded face");
    signed(&shape.outer) + shape.holes.iter().map(|h| signed(h)).sum::<f64>()
}

fn bounded(g: &Graph) -> Vec<FaceId> {
    g.live_faces()
        .filter(|&f| g.face(f).outer.is_some())
        .collect()
}

/// A closed polygon on `corners`, its sides keyed by event 0 and inserted in order.
fn polygon(g: &mut Graph, corners: &[Point]) -> (Vec<NodeId>, Vec<EdgeId>) {
    let nodes: Vec<NodeId> = corners
        .iter()
        .enumerate()
        .map(|(i, &p)| {
            g.add_node(
                Key::node(&[i as u32]),
                Level::Ground,
                p,
                NodeKind::Junction,
                Clock::ZERO,
            )
            .unwrap()
        })
        .collect();
    let n = corners.len();
    let sides = (0..n)
        .map(|i| {
            let j = (i + 1) % n;
            let spec = street(Key::edge(&event(0), i as u32), vec![corners[i], corners[j]]);
            let change = g
                .insert_edge(
                    spec,
                    [End::Node(nodes[i]), End::Node(nodes[j])],
                    Clock::ZERO,
                )
                .unwrap();
            assert_sound(g);
            change.born.edges[0]
        })
        .collect();
    (nodes, sides)
}

#[test]
fn versioned_values_follow_their_dates() {
    let mut rank = Versioned::new(Clock(10), 2u8);
    rank.set(Clock(30), 1);
    rank.set(Clock(20), 3);
    rank.set(Clock(30), 0);
    assert_eq!(rank.at(Clock(5)), None);
    assert_eq!(rank.at(Clock(10)), Some(&2));
    assert_eq!(rank.at(Clock(25)), Some(&3));
    assert_eq!(rank.at(Clock(99)), Some(&0));
    assert_eq!(rank.changes().len(), 3);
}

#[test]
fn keys_from_different_constructors_differ() {
    let keys = [
        Key::edge(&event(1), 0),
        Key::edge(&event(1), 1),
        Key::event(0, &[1, 0]),
        Key::node(&[3]),
        Key::outside(Level::Ground),
    ];
    let unique: BTreeSet<&Key> = keys.iter().collect();
    assert_eq!(unique.len(), keys.len());
    assert_eq!(Clock::from_units(1.2345).units(), 1.235);
}

#[test]
fn square_split_dangle_split_edge_and_merge() {
    let mut g = Graph::new(20.0);
    let corners = [
        pt(0.0, 0.0),
        pt(100.0, 0.0),
        pt(100.0, 100.0),
        pt(0.0, 100.0),
    ];
    let (n, _) = polygon(&mut g, &corners);
    let squares = bounded(&g);
    assert_eq!(squares.len(), 1);
    let square = squares[0];
    assert!((area(&g, square) - 10_000.0).abs() < 1e-6);
    assert_eq!(
        g.face(square).life.parents,
        vec![Key::outside(Level::Ground)]
    );

    // A diagonal splits the square into two triangles.
    let t1 = Clock::from_units(10.0);
    let spec = street(Key::edge(&event(1), 0), vec![corners[0], corners[2]]);
    let c = g
        .insert_edge(spec, [End::Node(n[0]), End::Node(n[2])], t1)
        .unwrap();
    assert_sound(&g);
    assert_eq!(c.retired.faces, vec![square]);
    assert_eq!(c.born.faces.len(), 2);
    let diagonal = c.born.edges[0];
    for &f in &c.born.faces {
        assert!((area(&g, f) - 5_000.0).abs() < 1e-6);
        assert_eq!(g.face(f).life.parents, vec![g.face(square).key.clone()]);
    }
    assert!(g.face(square).life.alive_at(Clock::ZERO) && !g.face(square).life.alive_at(t1));
    assert!(
        (area(&g, square) - 10_000.0).abs() < 1e-6,
        "a retired face keeps its outline"
    );
    assert_eq!(
        g.faces_at(Clock::ZERO)
            .filter(|&f| g.face(f).outer.is_some())
            .count(),
        1
    );

    // A dead end from a corner into the lower triangle leaves its face as it was.
    let t2 = Clock::from_units(20.0);
    let spec = street(Key::edge(&event(2), 0), vec![corners[1], pt(80.0, 30.0)]);
    let c = g
        .insert_edge(
            spec,
            [
                End::Node(n[1]),
                End::Free {
                    kind: NodeKind::DeadEnd,
                },
            ],
            t2,
        )
        .unwrap();
    assert_sound(&g);
    assert_eq!(c.born.nodes.len(), 1);
    assert!(c.born.faces.is_empty() && c.retired.faces.is_empty());
    let lower = g.face_at(Level::Ground, pt(70.0, 20.0));
    assert_eq!(lower, g.left_face(c.born.edges[0]));
    assert!((area(&g, lower) - 5_000.0).abs() < 1e-6);
    assert!(g.outline(lower).unwrap().holes.is_empty());
    assert_eq!(g.sectors(n[1], Level::Ground).len(), 3);

    // A street from the last corner to the middle of the diagonal splits the diagonal and
    // the upper triangle.
    let t3 = Clock::from_units(30.0);
    let spec = street(Key::edge(&event(3), 0), vec![corners[3], pt(50.0, 50.0)]);
    let end = End::OnEdge {
        edge: diagonal,
        kind: NodeKind::Junction,
    };
    let c = g.insert_edge(spec, [End::Node(n[3]), end], t3).unwrap();
    assert_sound(&g);
    assert_eq!(c.retired.edges, vec![diagonal]);
    assert_eq!((c.born.edges.len(), c.born.nodes.len()), (3, 1));
    assert_eq!((c.retired.faces.len(), c.born.faces.len()), (1, 2));
    for &f in &c.born.faces {
        assert!((area(&g, f) - 2_500.0).abs() < 1e-6);
    }
    for &piece in &c.born.edges[..2] {
        assert_eq!(
            g.edge(piece).life.parents,
            vec![g.edge(diagonal).key.clone()]
        );
        assert_eq!(g.edge(piece).stem, g.edge(diagonal).key);
    }
    let spur = c.born.edges[2];

    // Removing that street merges the two parts of the upper triangle into one face.
    let t4 = Clock::from_units(40.0);
    let c = g.remove_edge(spur, t4, None).unwrap();
    assert_sound(&g);
    assert_eq!((c.retired.faces.len(), c.born.faces.len()), (2, 1));
    let merged = c.born.faces[0];
    assert_eq!(g.face(merged).life.parents.len(), 2);
    assert!((area(&g, merged) - 5_000.0).abs() < 1e-6);
    assert_eq!(bounded(&g).len(), 2);

    // Dated changes and queries at a date.
    g.set_edge_rank(c.retired.edges[0], 1, t4).unwrap_err();
    let side = g.edge_id(&Key::edge(&event(0), 0)).unwrap();
    g.set_edge_class(side, EdgeClass::Wall, t4).unwrap();
    assert_eq!(g.edge(side).class.at(t3), Some(&EdgeClass::Street));
    assert_eq!(g.edge(side).class.at(t4), Some(&EdgeClass::Wall));
    assert!(g.edges_at(t3).any(|e| e == spur) && !g.edges_at(t4).any(|e| e == spur));
}

#[test]
fn crossing_edges_are_refused() {
    let mut g = Graph::new(20.0);
    let corners = [
        pt(0.0, 0.0),
        pt(100.0, 0.0),
        pt(100.0, 100.0),
        pt(0.0, 100.0),
    ];
    let (n, _) = polygon(&mut g, &corners);
    let at = Clock::from_units(1.0);
    let spec = street(Key::edge(&event(1), 0), vec![corners[0], corners[2]]);
    g.insert_edge(spec, [End::Node(n[0]), End::Node(n[2])], at)
        .unwrap();
    let spec = street(Key::edge(&event(2), 0), vec![corners[1], corners[3]]);
    let refused = g.insert_edge(spec, [End::Node(n[1]), End::Node(n[3])], at);
    assert!(matches!(refused, Err(GraphError::Crossing(_))));
    assert_sound(&g);
    let near = g.edges_near(Level::Ground, pt(50.0, 49.0), 1.0);
    assert_eq!(near.len(), 1);
    assert_eq!(
        g.edges_crossing(Level::Ground, pt(-10.0, 50.0), pt(110.0, 50.0))
            .len(),
        3
    );
}

#[test]
fn merged_nodes_keep_a_sound_graph() {
    let mut g = Graph::new(20.0);
    let corners = [
        pt(0.0, 0.0),
        pt(100.0, 0.0),
        pt(100.0, 100.0),
        pt(0.0, 100.0),
    ];
    let (n, _) = polygon(&mut g, &corners);
    let at = Clock::from_units(1.0);
    let spec = street(Key::edge(&event(1), 0), vec![corners[0], pt(48.0, 52.0)]);
    let c = g
        .insert_edge(
            spec,
            [
                End::Node(n[0]),
                End::Free {
                    kind: NodeKind::DeadEnd,
                },
            ],
            at,
        )
        .unwrap();
    let tip = c.born.nodes[0];
    let spec = street(Key::edge(&event(2), 0), vec![corners[2], pt(52.0, 48.0)]);
    let c = g
        .insert_edge(
            spec,
            [
                End::Node(n[2]),
                End::Free {
                    kind: NodeKind::DeadEnd,
                },
            ],
            at,
        )
        .unwrap();
    let other = c.born.nodes[0];
    assert_eq!(bounded(&g).len(), 1);
    let c = g
        .merge_nodes(tip, other, Clock::from_units(2.0))
        .unwrap();
    assert_sound(&g);
    assert_eq!(c.retired.nodes, vec![other]);
    assert_eq!(
        bounded(&g).len(),
        2,
        "the joined dead ends cut the square in two"
    );
}

/// Non-crossing chords of a regular polygon, some ending on its sides, inserted in shuffled
/// orders: the keys and the faces they bound are the same whatever the order.
#[test]
fn shuffled_chords_give_the_same_keys_and_faces() {
    const N: usize = 12;
    let corners: Vec<Point> = (0..N)
        .map(|i| {
            let a = TAU * i as f64 / N as f64;
            pt(100.0 * a.cos(), 100.0 * a.sin())
        })
        .collect();
    // Sites by perimeter parameter: whole numbers are corners, others points on a side.
    let mut sites: Vec<f64> = (0..N).map(|i| i as f64).collect();
    for s in [0usize, 4, 7] {
        sites.extend([s as f64 + 1.0 / 3.0, s as f64 + 2.0 / 3.0]);
    }
    let on_side = |t: f64| t.fract() != 0.0;
    let position = |t: f64| {
        let s = t.floor() as usize;
        let (a, b, f) = (corners[s], corners[(s + 1) % N], t - s as f64);
        pt(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
    };
    let sides_of = |t: f64| -> Vec<usize> {
        if on_side(t) {
            vec![t.floor() as usize]
        } else {
            vec![t as usize, (t as usize + N - 1) % N]
        }
    };
    let mut rng = Rng::new("graph-shuffled-chords");
    let mut chords: Vec<(f64, f64)> = Vec::new();
    let mut used: Vec<f64> = Vec::new();
    for _ in 0..1000 {
        if chords.len() == 9 {
            break;
        }
        let i = rng.int(0, sites.len() as u32 - 1) as usize;
        let j = rng.int(0, sites.len() as u32 - 1) as usize;
        let (x, y) = (sites[i].min(sites[j]), sites[i].max(sites[j]));
        let shares_side = sides_of(x).iter().any(|s| sides_of(y).contains(s));
        let reused = [x, y].iter().any(|&t| on_side(t) && used.contains(&t));
        let crosses = chords.iter().any(|&(a, b)| {
            (a, b) == (x, y) || (a < x && x < b && b < y) || (x < a && a < y && y < b)
        });
        if x == y || shares_side || reused || crosses {
            continue;
        }
        chords.push((x, y));
        used.extend([x, y].into_iter().filter(|&t| on_side(t)));
    }
    assert!(chords.len() >= 5, "too few chords: {chords:?}");

    let build = |order: &[usize]| -> Graph {
        let mut g = Graph::new(16.0);
        let (nodes, sides) = polygon(&mut g, &corners);
        let end = |t: f64| {
            if on_side(t) {
                End::OnEdge {
                    edge: sides[t.floor() as usize],
                    kind: NodeKind::Junction,
                }
            } else {
                End::Node(nodes[t as usize])
            }
        };
        for (step, &c) in order.iter().enumerate() {
            let (x, y) = chords[c];
            let spec = street(
                Key::edge(&event(1 + c as u32), 0),
                vec![position(x), position(y)],
            );
            let at = Clock::from_units(1.0 + step as f64);
            g.insert_edge(spec, [end(x), end(y)], at).unwrap();
            assert_sound(&g);
        }
        g
    };
    type Fingerprint = (
        BTreeSet<Key>,
        BTreeSet<Key>,
        BTreeMap<Key, (i64, Vec<(i64, i64)>)>,
    );
    let fingerprint = |g: &Graph| -> Fingerprint {
        let nodes = g.live_nodes().map(|n| g.node(n).key.clone()).collect();
        let edges = g.live_edges().map(|e| g.edge(e).key.clone()).collect();
        let faces = bounded(g)
            .into_iter()
            .map(|f| {
                let shape = g.outline(f).unwrap();
                let mut points: Vec<(i64, i64)> = shape
                    .outer
                    .iter()
                    .map(|p| ((p.x * 1e3).round() as i64, (p.y * 1e3).round() as i64))
                    .collect();
                points.sort_unstable();
                points.dedup();
                (
                    g.face(f).key.clone(),
                    ((signed(&shape.outer) * 100.0).round() as i64, points),
                )
            })
            .collect();
        (nodes, edges, faces)
    };
    let identity: Vec<usize> = (0..chords.len()).collect();
    let reference = fingerprint(&build(&identity));
    assert_eq!(reference.2.len(), chords.len() + 1);
    for trial in 0..6 {
        let mut order = identity.clone();
        let mut shuffle = rng.fork(&format!("order-{trial}"));
        for i in (1..order.len()).rev() {
            let j = shuffle.int(0, i as u32) as usize;
            order.swap(i, j);
        }
        assert_eq!(fingerprint(&build(&order)), reference, "order {order:?}");
    }
}
