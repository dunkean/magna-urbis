use std::collections::BTreeMap;

use magna_urbis_geom::{Point, signed};

use super::*;
use crate::graph::{
    Clock, EdgeClass, EdgeSpec, FaceKind, Graph, GraphError, Key, Level, NodeKind, Station,
};
use crate::tissue::{DraftStreet, TissueDraft};

fn pt(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn found_key() -> Key {
    found_kind().key()
}

fn found_kind() -> EventKind {
    EventKind::Found {
        center: pt(100.0, 50.0),
        focus: "site".into(),
    }
}

fn station(arm: u32) -> Station {
    Station {
        host: Key::node(&[1]),
        arm,
    }
}

fn quarter(arm: u32) -> Key {
    Key::quarter(1, &station(arm))
}

/// Side `i` of the founding rectangle.
fn side(i: u32) -> Key {
    Key::edge(&found_key(), i)
}

fn corner(i: u32) -> Key {
    Key::node(&[i])
}

fn h(households: f64) -> Clock {
    Clock::from_households(households)
}

/// A 200 x 100 rectangle on corners 0 to 5 (counter-clockwise from the origin), cut by a divider
/// from corner 1 to corner 4 into quarter A (arm 0, west) and quarter B (arm 1, east).
fn found_ops() -> Vec<Op> {
    let corners = [
        pt(0.0, 0.0),
        pt(100.0, 0.0),
        pt(200.0, 0.0),
        pt(200.0, 100.0),
        pt(100.0, 100.0),
        pt(0.0, 100.0),
    ];
    let mut ops: Vec<Op> = corners
        .iter()
        .enumerate()
        .map(|(i, &position)| Op::AddNode {
            key: corner(i as u32),
            level: Level::Ground,
            position,
            kind: NodeKind::Junction,
        })
        .collect();
    let mut sides: Vec<(u32, u32)> = (0..6).map(|i| (i, (i + 1) % 6)).collect();
    sides.push((1, 4));
    for (i, &(a, b)) in sides.iter().enumerate() {
        let mut spec = EdgeSpec::new(
            side(i as u32),
            Level::Ground,
            EdgeClass::Street,
            vec![corners[a as usize], corners[b as usize]],
            6.0,
        );
        if (a, b) == (1, 4) {
            spec.chain = Some(side(6));
            spec.face_names = Some([Key::block(&quarter(0), &[]), Key::block(&quarter(1), &[])]);
        }
        ops.push(Op::InsertEdge {
            spec,
            ends: [
                Anchor::Node { node: corner(a) },
                Anchor::Node { node: corner(b) },
            ],
        });
    }
    ops
}

fn founded() -> Writer {
    let mut writer = Writer::new(16.0);
    writer.set_checked(true);
    writer
        .apply(Clock::ZERO, found_kind(), found_ops())
        .unwrap();
    writer
}

fn street(path: Vec<Point>) -> DraftStreet {
    let widths = vec![4.0; path.len()];
    DraftStreet {
        path,
        rank: 2,
        role: "street".into(),
        widths,
    }
}

/// Quarter A: a street across from the west side to the divider, and one from it to the top.
/// Quarter B: a street from the divider to the east side, and one from it to the bottom.
fn drafts() -> [QuarterDraft; 2] {
    let a = QuarterDraft {
        ring: 1,
        station: station(0),
        tissue: "organic".into(),
        outline: vec![side(0), side(6), side(4), side(5)],
        draft: TissueDraft {
            streets: vec![
                street(vec![pt(0.0, 50.0), pt(40.0, 52.0), pt(100.0, 50.0)]),
                street(vec![pt(40.0, 52.0), pt(50.0, 100.0)]),
            ],
        },
    };
    let b = QuarterDraft {
        ring: 1,
        station: station(1),
        tissue: "organic".into(),
        outline: vec![side(1), side(2), side(3), side(6)],
        draft: TissueDraft {
            streets: vec![
                street(vec![pt(100.0, 75.0), pt(200.0, 75.0)]),
                street(vec![pt(150.0, 75.0), pt(150.0, 0.0)]),
            ],
        },
    };
    [a, b]
}

/// Dates one household apart, following the journal's length.
fn next_date(writer: &Writer, _: &QuarterDraft) -> Option<Clock> {
    Some(h(writer.journal().events.len() as f64))
}

type Print = (
    BTreeMap<Key, (i64, i64)>,
    BTreeMap<Key, (EdgeClass, Vec<(i64, i64)>)>,
    BTreeMap<Key, (FaceKind, i64)>,
);

fn grid(p: Point) -> (i64, i64) {
    ((p.x * 1e3).round() as i64, (p.y * 1e3).round() as i64)
}

/// Live keys with their geometry, class and kind.
fn print(g: &Graph) -> Print {
    let nodes = g
        .live_nodes()
        .map(|n| (g.node(n).key.clone(), grid(g.node(n).position)))
        .collect();
    let edges = g
        .live_edges()
        .map(|e| {
            let edge = g.edge(e);
            let points: Vec<(i64, i64)> = edge.polyline.iter().map(|&p| grid(p)).collect();
            (edge.key.clone(), (*edge.class.current(), points))
        })
        .collect();
    let faces = g
        .live_faces()
        .filter_map(|f| {
            let shape = g.outline(f)?;
            let face = g.face(f);
            Some((
                face.key.clone(),
                (
                    *face.kind.current(),
                    (signed(&shape.outer) * 100.0).round() as i64,
                ),
            ))
        })
        .collect();
    (nodes, edges, faces)
}

#[test]
fn drafts_commit_to_the_same_keys_in_any_order() {
    let [a, b] = drafts();
    let mut forward = founded();
    let done = commit_drafts(&mut forward, vec![a.clone(), b.clone()], next_date);
    assert!(done.iter().all(|c| c.result.is_ok()), "{done:?}");
    assert_eq!(
        forward
            .graph()
            .faces_at(h(10.0))
            .filter(|&f| forward.graph().face(f).outer.is_some())
            .count(),
        6
    );
    let mut backward = founded();
    commit_drafts(&mut backward, vec![b.clone(), a.clone()], next_date);
    assert_eq!(
        backward.journal(),
        forward.journal(),
        "commits follow the station order"
    );

    // Applied by hand in the other order, each draft seated on the graph the other left: the
    // operations differ where streets meet the shared divider, the keys do not.
    let mut reversed = founded();
    for (i, d) in [&b, &a].into_iter().enumerate() {
        let ops = ops_for_draft(&d.draft, &d.key(), &d.outline, reversed.graph());
        let kind = EventKind::OpenQuarter {
            ring: d.ring,
            station: d.station.clone(),
            tissue: d.tissue.clone(),
            outline: d.outline.clone(),
        };
        reversed.apply(h(1.0 + i as f64), kind, ops).unwrap();
    }
    assert_eq!(print(reversed.graph()), print(forward.graph()));
    let block = Key::block(&quarter(0), &[]);
    assert!(
        !reversed
            .graph()
            .face(reversed.graph().face_id(&block).unwrap())
            .life
            .live()
    );
    let named = Key::edge(&quarter(1), 0).child(crate::graph::tag::BLOCK, &[0]);
    assert!(
        forward.graph().face_id(&named).is_some(),
        "faces split off by a street are named by it"
    );
}

#[test]
fn a_failed_operation_rolls_the_event_back() {
    let mut writer = founded();
    let before = print(writer.graph());
    let diagonal = |key: u32, from: u32, to: u32, a: Point, b: Point| Op::InsertEdge {
        spec: EdgeSpec::new(
            Key::edge(&Key::event(3, &[1]), key),
            Level::Ground,
            EdgeClass::Lane,
            vec![a, b],
            3.0,
        ),
        ends: [
            Anchor::Node { node: corner(from) },
            Anchor::Node { node: corner(to) },
        ],
    };
    let ops = vec![
        diagonal(0, 0, 4, pt(0.0, 0.0), pt(100.0, 100.0)),
        diagonal(1, 5, 1, pt(0.0, 100.0), pt(100.0, 0.0)),
    ];
    let refused = writer.apply(h(1.0), EventKind::ExtendArmature { ring: 1 }, ops);
    assert!(
        matches!(
            refused,
            Err(JournalError::Graph {
                op: 1,
                error: GraphError::Crossing(_)
            })
        ),
        "{refused:?}"
    );
    assert_eq!(writer.journal().events.len(), 1);
    assert!(
        writer
            .graph()
            .edge_id(&Key::edge(&Key::event(3, &[1]), 0))
            .is_none()
    );
    assert_eq!(print(writer.graph()), before);
    assert!(writer.graph().check_invariants().is_empty());

    let ops = vec![
        Op::AddNode {
            key: Key::node(&[50]),
            level: Level::Ground,
            position: pt(50.0, 50.0),
            kind: NodeKind::Junction,
        },
        Op::SetNodeKind {
            node: Key::node(&[51]),
            kind: NodeKind::Gate,
        },
    ];
    let refused = writer.apply(h(1.0), EventKind::ExtendArmature { ring: 1 }, ops);
    assert_eq!(
        refused,
        Err(JournalError::UnknownKey {
            op: 1,
            key: Key::node(&[51])
        })
    );
    assert!(writer.graph().node_id(&Key::node(&[50])).is_none());

    // A refused event can be applied again once its operations are sound.
    let ops = vec![diagonal(0, 0, 4, pt(0.0, 0.0), pt(100.0, 100.0))];
    assert_eq!(
        writer.apply(h(1.0), EventKind::ExtendArmature { ring: 1 }, ops),
        Ok(1)
    );
    assert!(matches!(
        writer.apply(h(0.5), EventKind::ExtendArmature { ring: 2 }, vec![]),
        Err(JournalError::ClockBackwards { .. })
    ));
}

/// Found, two quarters and a chain retype, with the graph after each event.
fn grown() -> (Writer, Vec<Print>) {
    let mut writer = founded();
    let mut prints = vec![print(writer.graph())];
    for d in drafts() {
        let done = commit_drafts(&mut writer, vec![d], next_date);
        assert!(done[0].result.is_ok(), "{done:?}");
        prints.push(print(writer.graph()));
    }
    let retype = EventKind::RetypeChain {
        chain: side(6),
        step: 0,
        class: Some(EdgeClass::Wall),
        rank: None,
    };
    let ops = vec![Op::SetChainClass {
        chain: side(6),
        class: EdgeClass::Wall,
    }];
    writer.apply(h(10.0), retype, ops).unwrap();
    prints.push(print(writer.graph()));
    (writer, prints)
}

#[test]
fn replay_rebuilds_the_graph_at_every_event() {
    let (writer, prints) = grown();
    let journal = writer.journal();
    assert_eq!(journal.events.len(), prints.len());
    for (event, expected) in journal.events.iter().zip(&prints) {
        let replayed = journal.replay_until(&event.key).unwrap();
        assert_eq!(&print(replayed.graph()), expected, "at {:?}", event.key);
        assert!(replayed.graph().check_invariants().is_empty());
    }
    assert_eq!(
        print(journal.replay_prefix(0).unwrap().graph()),
        print(&Graph::new(16.0))
    );
    let walls = writer
        .graph()
        .live_edges()
        .filter(|&e| writer.graph().edge(e).chain.as_ref() == Some(&side(6)))
        .collect::<Vec<_>>();
    assert_eq!(walls.len(), 3, "the divider is in three pieces");
    for e in walls {
        assert_eq!(
            writer.graph().edge(e).class.at(h(9.0)),
            Some(&EdgeClass::Street)
        );
        assert_eq!(
            writer.graph().edge(e).class.at(h(10.0)),
            Some(&EdgeClass::Wall)
        );
    }
    assert!(matches!(
        journal.replay_until(&Key::event(99, &[])),
        Err(JournalError::UnknownEvent(_))
    ));
}

#[test]
fn a_checkpoint_survives_serialisation_and_resumes() {
    let (mut live, prints) = grown();
    let cursor = Cursor {
        ring: 1,
        last_station: Some(station(1)),
        cost_field_at: 1,
    };
    let checkpoint = live.checkpoint(cursor);
    let json = serde_json::to_string(&checkpoint).unwrap();
    let back: Checkpoint = serde_json::from_str(&json).unwrap();
    assert_eq!(back, checkpoint);
    assert_eq!(print(&back.frozen_graph().unwrap()), prints[0]);

    let mut resumed = back.resume().unwrap();
    assert_eq!(print(resumed.graph()), print(live.graph()));
    let next = || {
        let kind = EventKind::Promote {
            phase: 1,
            name: "village".into(),
        };
        let ops = vec![Op::SetNodeKind {
            node: corner(0),
            kind: NodeKind::TownEntry,
        }];
        (kind, ops)
    };
    let (kind, ops) = next();
    live.apply(h(12.0), kind, ops).unwrap();
    let (kind, ops) = next();
    resumed.apply(h(12.0), kind, ops).unwrap();
    assert_eq!(resumed.journal(), live.journal());
    assert_eq!(print(resumed.graph()), print(live.graph()));
}
