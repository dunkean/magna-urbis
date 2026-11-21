use std::collections::BTreeMap;

use magna_urbis_geom::{Point, Shape, surface::TerrainView};

use super::*;
use crate::armature::focus_key;
use crate::charter::{FoundingFocus, HarbourSite};
use crate::graph::{Clock, EdgeSpec, Station};
use crate::journal::{Anchor, Op, Writer};
use crate::spec::{
    DefensiveIntent, HarbourEnclosure, HarbourThresholds, HarbourWorksSpec, SurveySpec, TownDraws,
    TownForm,
};

const WIDTH: f64 = 1024.0;
/// The sea begins at this abscissa; the coast runs north to south.
const SHORE: f64 = 608.0;

/// Flat land west of a straight sea coast.
struct Coast;

impl TerrainView for Coast {
    fn width(&self) -> f64 {
        WIDTH
    }

    fn height_resolution(&self) -> usize {
        512
    }

    fn water_resolution(&self) -> usize {
        512
    }

    fn height_at(&self, _: Point) -> f64 {
        0.0
    }

    fn wet(&self, p: Point) -> bool {
        !(0.0..WIDTH).contains(&p.x) || !(0.0..WIDTH).contains(&p.y) || p.x >= SHORE
    }

    fn water_code(&self, p: Point) -> u8 {
        if p.x >= SHORE { 1 } else { 0 }
    }

    fn dry_clip(&self, _: &Shape) -> Vec<Shape> {
        panic!("the harbour does not clip polygons");
    }
}

const fn p(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn spec() -> HarbourSpec {
    HarbourSpec {
        enclosure_habit: HarbourEnclosure::OpenFront,
        quay_per_sqrt_pop: 6.0,
        thresholds: HarbourThresholds {
            landing: 0,
            piers: None,
            moles: None,
            basins: None,
        },
        works: HarbourWorksSpec::default(),
    }
}

fn survey(center: Point, reach: f64) -> Survey {
    Survey::new(&Coast, center, reach, None, &[], &SurveySpec::default()).unwrap()
}

fn charter(kind: FoundingFocusKind, focus: Point, survey: &Survey) -> Charter {
    let front = survey.fronts().first().map(|f| HarbourSite {
        bank_id: f.bank_id,
        station: f.station,
        position: p(SHORE - 0.01, focus.y),
    });
    Charter {
        culture: "test".into(),
        site_archetype: None,
        center: focus,
        pinned: false,
        radius: None,
        focus: FoundingFocus {
            kind,
            position: focus,
        },
        harbour_front: front,
        form: TownForm::Grown,
        founding_cohort: 0,
        founding_tissue_id: String::new(),
        defensive_intent: DefensiveIntent::Never,
        draws: TownDraws {
            phases: BTreeMap::new(),
            harbour_enclosure: HarbourEnclosure::OpenFront,
        },
    }
}

/// A town founded at `focus` with one street running north to south at `street_x`.
fn founded(focus: Point, street_x: f64) -> Writer {
    let mut writer = Writer::new(32.0);
    let kind = EventKind::Found {
        center: focus,
        focus: "harbour-front".into(),
    };
    let found = kind.key();
    let street = EdgeSpec::new(
        Key::edge(&found, 0),
        Level::Ground,
        EdgeClass::Street,
        vec![p(street_x, 400.0), p(street_x, 620.0)],
        6.0,
    );
    let free = Anchor::Free {
        kind: NodeKind::StreetEnd,
    };
    let ops = vec![Op::InsertEdge {
        spec: street,
        ends: [free.clone(), free],
    }];
    writer.apply(Clock::ZERO, kind, ops).unwrap();
    writer
}

/// A coast town founded on its front, its harbour opened at `inhabitants`.
fn opened_town(inhabitants: u32) -> (Survey, FrontChoice, Writer, HarbourState) {
    let focus = p(600.0, 512.0);
    let survey = survey(p(560.0, 512.0), 300.0);
    let charter = charter(FoundingFocusKind::HarbourFront, focus, &survey);
    let choice = choose_front(&survey, &charter, &spec()).expect("the town's front");
    let mut writer = founded(focus, 560.0);
    let kind = EventKind::OpenHarbour {
        front: choice.index,
    };
    let at = Clock::from_households(100.0);
    let ops = open_harbour(
        &writer,
        at,
        &kind.key(),
        &survey,
        &choice,
        &spec(),
        inhabitants,
    )
    .expect("a quay on the front");
    writer.apply(at, kind, ops).unwrap();
    let state = HarbourState::read(writer.graph(), writer.journal(), choice.clone(), &spec())
        .expect("the opened harbour");
    (survey, choice, writer, state)
}

#[test]
fn a_coast_town_founded_on_its_front_gets_a_quay_at_the_focus() {
    let (_, choice, writer, state) = opened_town(1000);
    assert!(choice.at_focus);
    let wanted = quay_length(&spec(), 1000);
    assert!(
        (state.length() - wanted).abs() < 6.0,
        "{} m of quay for {wanted} m wanted",
        state.length()
    );
    let middle = line::point_at(&choice.line, (state.span[0] + state.span[1]) * 0.5).0;
    assert!(
        middle.distance(p(600.0, 512.0)) < 20.0,
        "quay centred on the focus"
    );
    let graph = writer.graph();
    let quay: Vec<_> = graph
        .live_edges()
        .filter(|&e| *graph.edge(e).class.current() == EdgeClass::Quay)
        .collect();
    assert!(!quay.is_empty());
    // The quay stands on the waterline: within a quay width of the shore.
    for &e in &quay {
        for q in &graph.edge(e).polyline {
            assert!((SHORE - q.x).abs() < spec().works.quay_width, "{q:?}");
        }
    }
    assert!(!state.landings.is_empty(), "a landing on the quay");
    let landing_streets = graph.faces_along_chain(&landing_chain(choice.index));
    assert!(!landing_streets.is_empty(), "a landing street to the town");
    let streets = export_quays(graph, &state);
    assert_eq!(streets.iter().filter(|s| s.role == "quay").count(), 1);
}

#[test]
fn a_town_four_hundred_metres_inland_gets_a_harbour_road_and_a_front() {
    let focus = p(200.0, 512.0);
    let survey = survey(focus, 600.0);
    let charter = charter(FoundingFocusKind::Site, focus, &survey);
    assert!(
        choose_front(&survey, &charter, &spec()).is_none(),
        "not a port town"
    );
    let mut port = spec();
    port.works.port_town = true;
    let choice = choose_front(&survey, &charter, &port).expect("a front within reach");
    assert!(!choice.at_focus, "the harbour is distant");
    assert!((choice.landing.distance(focus) - 405.0).abs() < 10.0);

    let road = harbour_road(&survey, focus, &choice, &port).expect("a road to the water");
    assert_eq!(road[0], focus);
    assert_eq!(*road.last().unwrap(), choice.landing);
    let length = line::length(&road);
    assert!(
        (395.0..450.0).contains(&length),
        "{length} m of harbour road"
    );
    assert!(road.iter().all(|&q| !Coast.wet(q)));

    let writer = Writer::new(32.0);
    let kind = EventKind::Found {
        center: focus,
        focus: "site".into(),
    };
    let found = kind.key();
    let mut stage = writer.stage(Clock::ZERO);
    stage
        .try_push(vec![Op::AddNode {
            key: focus_key(),
            level: Level::Ground,
            position: focus,
            kind: NodeKind::Junction,
        }])
        .unwrap();
    let landing = lay_harbour_road(&mut stage, &found, &road, &focus_key(), &port)
        .expect("the road laid at founding");
    let mut writer = writer;
    writer.apply(Clock::ZERO, kind, stage.into_ops()).unwrap();
    let graph = writer.graph();
    let node = graph.node(graph.node_id(&landing).unwrap());
    assert_eq!(*node.kind.current(), NodeKind::Landing);
    assert!(!graph.faces_along_chain(&road_chain(&found)).is_empty());

    let discount = front_discount(&choice, &port, 0.75);
    assert!((discount.at(choice.landing) - 0.75 * port.works.front_discount).abs() < 1e-6);
    assert_eq!(discount.at(focus), 0.0);
}

#[test]
fn the_quay_grows_with_the_square_root_of_the_population() {
    let mut cap = spec();
    cap.works.quay_share = 1.0;
    let ratio = quay_length(&cap, 160_000) / quay_length(&cap, 40_000);
    assert!((ratio - 2.0).abs() < 1e-9);
    assert_eq!(quay_length(&spec(), 100), spec().works.min_quay);

    let (survey, choice, mut writer, state) = opened_town(1000);
    let phase = spec().thresholds;
    assert!(extension_due(&state, &spec(), &phase, 20_000));
    let kind = EventKind::ExtendHarbour {
        front: choice.index,
        step: 1,
        quay_length: quay_length(&spec(), 20_000),
    };
    let at = Clock::from_households(5000.0);
    let ops = extend_harbour(
        &writer,
        at,
        &kind.key(),
        &survey,
        &state,
        &spec(),
        &phase,
        20_000,
    )
    .expect("a longer quay");
    writer.apply(at, kind, ops).unwrap();
    let longer = HarbourState::read(writer.graph(), writer.journal(), choice, &spec()).unwrap();
    assert!(
        longer.length() > state.length() + 200.0,
        "{} m",
        longer.length()
    );
    assert!(longer.span[0] <= state.span[0] && longer.span[1] >= state.span[1]);
    assert!(longer.landings.len() > state.landings.len());
    assert_eq!(longer.extensions, 1);
}

#[test]
fn port_quarters_are_those_on_harbour_nodes() {
    let (_, _, writer, state) = opened_town(1000);
    let record = |host: Key, arm: u32| QuarterRecord {
        key: Key::quarter(
            1,
            &Station {
                host: host.clone(),
                arm,
            },
        ),
        ring: 1,
        station: Station { host, arm },
        phase: 0,
        tissue: "organic".into(),
        intramural: false,
        faces: Vec::new(),
        fill_schedule: vec![1.0],
        levels: vec![Clock::ZERO],
        step: 0,
        compact_step: None,
    };
    let on_quay = record(state.landings[0].1.clone(), 0);
    let inland = record(Key::node(&[99]), 0);
    let ports = port_quarters(writer.graph(), &[on_quay.clone(), inland], &state);
    assert_eq!(ports, vec![on_quay.key]);
}
