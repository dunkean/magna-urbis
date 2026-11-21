use std::f64::consts::PI;

use magna_urbis_geom::{Point, Shape, surface::TerrainView};

use super::span::unit;
use super::{
    Crossing, CrossingKind, WaterInputs, cross_water, far_bank_due, far_landings, flow, ford_stems,
};
use crate::armature::{self, Arm};
use crate::graph::{Clock, EdgeClass, EdgeSpec, Key, Level, NodeKind, tag};
use crate::journal::{Anchor, EventKind, Op, Writer};
use crate::spec::{CrossingSpec, GrowthSpec, SurveySpec};
use crate::survey::{CostField, CostPath, Survey};

const WIDTH: f64 = 1024.0;
/// The founding focus of the river towns, on the west bank.
const FOCUS: Point = p(400.0, 512.0);
/// The tip of their one axis, running east towards the water.
const TIP: Point = p(470.0, 512.0);
/// Direction of the oblique river, 60° from east.
const FLOW: (f64, f64) = (0.5, 0.866_025_403_784_438_6);

/// Flat land with water where `water` gives a water code.
struct Water(fn(Point) -> Option<u8>);

impl TerrainView for Water {
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

    fn wet(&self, q: Point) -> bool {
        !(0.0..WIDTH).contains(&q.x) || !(0.0..WIDTH).contains(&q.y) || (self.0)(q).is_some()
    }

    fn water_code(&self, q: Point) -> u8 {
        (self.0)(q).unwrap_or(0)
    }

    fn dry_clip(&self, _: &Shape) -> Vec<Shape> {
        panic!("water crossings do not clip polygons");
    }
}

/// A river 32 m wide running at 60° through (520, 512).
const OBLIQUE: Water = Water(|q| {
    let across = (q.x - 520.0) * -FLOW.1 + (q.y - 512.0) * FLOW.0;
    (across.abs() < 16.0).then_some(3)
});

/// A stream 6 m wide running north to south.
const STREAM: Water = Water(|q| (500.0..506.0).contains(&q.x).then_some(3));

/// A lake reaching beyond the survey, with an island of radius 120 m at its centre.
const ISLAND: Water = Water(|q| (q.distance(p(512.0, 512.0)) > 120.0).then_some(2));

const fn p(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn survey(terrain: &Water, centre: Point, reach: f64) -> Survey {
    Survey::new(terrain, centre, reach, None, &[], &SurveySpec::default()).unwrap()
}

/// A founded town and its axes.
struct Town {
    writer: Writer,
    arms: Vec<Arm>,
}

/// A town founded at `focus` with one axis from it to `tip`.
fn town(focus: Point, tip: Point) -> Town {
    let mut writer = Writer::new(32.0);
    writer.set_checked(true);
    let kind = EventKind::Found {
        center: focus,
        focus: "site".into(),
    };
    let found = kind.key();
    let chain = found.child(tag::ARM, &[0]);
    let mut spec = EdgeSpec::new(
        Key::edge(&found, 0),
        Level::Ground,
        EdgeClass::Street,
        vec![focus, tip],
        8.0,
    );
    spec.chain = Some(chain.clone());
    let ops = vec![Op::InsertEdge {
        spec,
        ends: [
            Anchor::Free {
                kind: NodeKind::Junction,
            },
            Anchor::Free {
                kind: NodeKind::StreetEnd,
            },
        ],
    }];
    writer.apply(Clock::ZERO, kind, ops).unwrap();
    let arm = Arm {
        chain,
        bearing: (tip.y - focus.y).atan2(tip.x - focus.x),
        rank: 0,
        width: 8.0,
    };
    Town {
        writer,
        arms: vec![arm],
    }
}

/// The cost field over the town as it stands, its crossings included.
fn cost_field(survey: &Survey, town: &Town) -> CostField {
    let growth = GrowthSpec::default();
    let graph = town.writer.graph();
    let mut lines = armature::cost_lines(graph, &growth, &town.arms);
    lines.extend(super::cost_lines(
        graph,
        town.writer.journal(),
        &growth,
        &CrossingSpec::default(),
    ));
    let paths: Vec<CostPath<'_>> = lines
        .iter()
        .map(|line| CostPath {
            points: &line.points,
            multiplier: line.multiplier,
            allow_crossings: line.crossings,
        })
        .collect();
    survey.recompute_costs(&paths)
}

fn due(
    survey: &Survey,
    town: &Town,
    focus: Point,
    level: f64,
    inhabitants: f64,
    spec: &CrossingSpec,
) -> Option<Crossing> {
    let costs = cost_field(survey, town);
    let growth = GrowthSpec::default();
    let inputs = WaterInputs {
        survey,
        costs: &costs,
        graph: town.writer.graph(),
        journal: town.writer.journal(),
        arms: &town.arms,
        focus,
        level,
        inhabitants,
        water_charge: SurveySpec::default().water_charge,
        growth: &growth,
        spec,
    };
    far_bank_due(&inputs)
}

/// Apply a crossing to the town.
fn apply(town: &mut Town, crossing: &Crossing) {
    let ops = cross_water(town.writer.graph(), crossing).expect("the crossing is drawn");
    town.writer
        .apply(Clock(1000), crossing.event(), ops)
        .expect("the writer takes the crossing");
}

#[test]
fn the_flow_follows_the_river() {
    let site = survey(&OBLIQUE, FOCUS, 450.0);
    let angle = flow(&site, p(520.0, 512.0), 64.0).expect("a river has a flow");
    let off = (angle - PI / 3.0).rem_euclid(PI);
    let off = off.min(PI - off);
    assert!(off < 5f64.to_radians(), "flow {angle} rad, off by {off} rad");
}

#[test]
fn a_town_crosses_the_river_once_its_near_bank_is_used() {
    let site = survey(&OBLIQUE, FOCUS, 450.0);
    let mut town = town(FOCUS, TIP);
    let spec = CrossingSpec::default();
    assert!(
        due(&site, &town, FOCUS, 150.0, 20_000.0, &spec).is_none(),
        "the near bank's land is still cheaper than the crossing"
    );
    let crossing =
        due(&site, &town, FOCUS, 400.0, 20_000.0, &spec).expect("the far bank is due");
    assert_eq!(crossing.kind, CrossingKind::Bridge);
    assert_ne!(crossing.near_bank, crossing.far_bank);
    assert_eq!(site.bank_id_at(FOCUS), Some(crossing.near_bank));
    assert_eq!(site.bank_id_at(crossing.span[1]), Some(crossing.far_bank));
    assert_eq!(crossing.chain, town.arms[0].chain, "the axis is prolonged");

    apply(&mut town, &crossing);
    let graph = town.writer.graph();
    assert!(graph.live_edges().any(|e| {
        let edge = graph.edge(e);
        *edge.class.current() == EdgeClass::Bridge && edge.level == Level::Deck
    }));
    let landings = far_landings(graph, town.writer.journal());
    assert_eq!(landings.len(), 1);
    assert!(
        cost_field(&site, &town).cost_at(landings[0]).is_finite(),
        "the far bank is reached over the bridge"
    );
    assert!(
        due(&site, &town, FOCUS, 400.0, 20_000.0, &spec).is_none(),
        "the river is crossed once"
    );
}

#[test]
fn the_bridge_is_square_to_the_flow() {
    let site = survey(&OBLIQUE, FOCUS, 450.0);
    let town = town(FOCUS, TIP);
    let crossing = due(&site, &town, FOCUS, 400.0, 20_000.0, &CrossingSpec::default())
        .expect("the far bank is due");
    let axis = unit(crossing.span[0], crossing.span[1]);
    let along = (axis.0 * FLOW.0 + axis.1 * FLOW.1).abs();
    assert!(
        along < 15f64.to_radians().sin(),
        "the deck runs {:.1}° off square",
        along.asin().to_degrees()
    );
}

#[test]
fn a_narrow_stream_gets_a_ford() {
    let site = survey(&STREAM, FOCUS, 450.0);
    let mut town = town(FOCUS, TIP);
    let spec = CrossingSpec {
        ford_span: 16.0,
        ..CrossingSpec::default()
    };
    let crossing = due(&site, &town, FOCUS, 400.0, 500.0, &spec).expect("the far bank is due");
    assert_eq!(crossing.kind, CrossingKind::Ford);

    apply(&mut town, &crossing);
    let fords = ford_stems(town.writer.journal());
    assert_eq!(fords.len(), 1);
    let graph = town.writer.graph();
    let ford = graph
        .live_edges()
        .map(|e| graph.edge(e))
        .find(|edge| fords.contains(&edge.stem))
        .expect("the ford stands");
    assert_eq!(*ford.class.current(), EdgeClass::Street);
    assert_eq!(ford.level, Level::Ground);
}

#[test]
fn a_town_on_an_island_with_no_reachable_bank_stays_on_it() {
    let centre = p(512.0, 512.0);
    let site = survey(&ISLAND, centre, 400.0);
    let town = town(centre, p(600.0, 512.0));
    assert!(due(&site, &town, centre, 1.0e6, 20_000.0, &CrossingSpec::default()).is_none());
}
