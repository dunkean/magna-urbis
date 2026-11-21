use magna_urbis_geom::Point;

use super::{group_road_fates, import_regional_roads, road_fates, road_result};
use crate::RegionalRoad;
use crate::armature::{Draw, arcs, chain_ops};
use crate::charter::{Charter, FoundingFocus};
use crate::export::RoadResult;
use crate::graph::{Clock, EdgeClass, FaceKind, Graph, Level, NodeKind};
use crate::journal::{EventKind, Op, Writer};
use crate::spec::{
    CircumstanceModifiers, DefensiveIntent, ExtensionHabit, FossilRule, FoundingFocusKind,
    HarbourEnclosure, HarbourThresholds, PhaseSpec, ProgrammeThresholds, RoadFate, TownDraws,
    TownForm,
};

const CENTRE: Point = point(0.0, 0.0);
const ID: &str = "segment:4";

const fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn charter(form: TownForm) -> Charter {
    Charter {
        culture: "european-organic".into(),
        site_archetype: None,
        center: CENTRE,
        pinned: true,
        radius: None,
        focus: FoundingFocus {
            kind: FoundingFocusKind::Site,
            position: CENTRE,
        },
        harbour_front: None,
        form,
        founding_cohort: 0,
        founding_tissue_id: "organic".into(),
        defensive_intent: DefensiveIntent::Never,
        draws: TownDraws {
            phases: Default::default(),
            harbour_enclosure: HarbourEnclosure::HarbourOutside,
        },
    }
}

fn phase(name: &str, road_fate: RoadFate) -> PhaseSpec {
    PhaseSpec {
        name: name.into(),
        threshold: 0,
        threshold_spread: 0.0,
        circumstance_modifiers: CircumstanceModifiers {
            road_crossing: 1.0,
            navigable_harbour: 1.0,
            isolated_site: 1.0,
            steep_site: 1.0,
        },
        tissue_id: "organic".into(),
        compact_tissue_id: "organic".into(),
        density: 100.0,
        compact_density: 100.0,
        fill_schedule: vec![1.0],
        wall_kind: None,
        wall_styles: vec![],
        walls_when_grown: false,
        precinct_step: 1.0,
        precinct_gain: 0.0,
        precinct_step_spread: 0.0,
        precinct_gain_spread: 0.0,
        fossil_rule: FossilRule::Boulevard,
        extension_habit: ExtensionHabit::Lobes,
        road_fate,
        planned_road_fate: RoadFate::Absorbed,
        programme: ProgrammeThresholds {
            market: None,
            hall: None,
            cathedral: None,
        },
        harbour_works: HarbourThresholds {
            landing: 0,
            piers: None,
            moles: None,
            basins: None,
        },
    }
}

fn found_road() -> Writer {
    let mut writer = Writer::new(32.0);
    let kind = EventKind::Found {
        center: CENTRE,
        focus: "site".into(),
    };
    let mut stage = writer.stage(Clock::ZERO);
    let road = RegionalRoad {
        id: ID.into(),
        points: vec![point(-200.0, 0.0), point(200.0, 0.0)],
        stations: vec![1000.0, 1400.0],
        rank: 1,
    };
    assert_eq!(
        import_regional_roads(&mut stage, &kind.key(), &[road], CENTRE, 160.0, 8.0),
        0
    );
    writer.apply(Clock::ZERO, kind, stage.into_ops()).unwrap();
    let graph = writer.graph();
    let edge = graph.edge(graph.live_edges().next().unwrap());
    assert_eq!(
        edge.road_source.as_ref().unwrap().stations,
        [1040.0, 1360.0]
    );
    writer
}

fn open_ring(writer: &mut Writer, ring: u32, radius: f64, clock: Clock) {
    let kind = EventKind::ExtendArmature { ring };
    let event = kind.key();
    let mut stage = writer.stage(clock);
    let outline = [
        point(-radius, -radius),
        point(radius, -radius),
        point(radius, radius),
        point(-radius, radius),
    ];
    let boundaries = arcs(stage.graph(), &outline, 0.0);
    assert!(!boundaries.is_empty());
    let mut next_rank = 0;
    for arc in boundaries {
        let draw = Draw {
            event: &event,
            next_rank: &mut next_rank,
            chain: None,
            class: EdgeClass::Boundary,
            rank: 4,
            width: 6.0,
        };
        let (ops, _) = chain_ops(draw, &arc.path, arc.start, arc.end, &arc.hits);
        stage.try_push(ops).unwrap();
    }
    // The land the loop closes joins the town, as an opened quarter does.
    let graph = stage.graph();
    let outside = graph.outside(Level::Ground);
    let blocks: Vec<Op> = graph
        .live_faces()
        .filter(|&f| f != outside && *graph.face(f).kind.current() == FaceKind::Unbuilt)
        .map(|f| Op::SetFaceKind {
            face: graph.face(f).key.clone(),
            kind: FaceKind::Block,
        })
        .collect();
    stage.try_push(blocks).unwrap();
    writer.apply(clock, kind, stage.into_ops()).unwrap();
}

fn apply_fate(writer: &mut Writer, phase: &PhaseSpec, charter: &Charter, clock: Clock) {
    let graph = writer.graph();
    let fates = group_road_fates(graph, road_fates(graph, phase, charter, clock));
    for (chain, ops) in fates {
        let step = writer
            .journal()
            .events
            .iter()
            .filter(
                |e| matches!(&e.kind, EventKind::RetypeChain { chain: key, .. } if *key == chain),
            )
            .count() as u32;
        writer
            .apply(
                clock,
                EventKind::RetypeChain {
                    chain,
                    step,
                    class: None,
                    rank: None,
                },
                ops,
            )
            .unwrap();
    }
    assert!(road_fates(writer.graph(), phase, charter, clock).is_empty());
}

fn road_at(graph: &Graph, x: f64) -> (EdgeClass, u8) {
    let id = graph
        .edges_near(Level::Ground, point(x, 0.0), 0.0001)
        .into_iter()
        .find(|&id| graph.edge(id).road_source.is_some())
        .unwrap();
    let edge = graph.edge(id);
    (*edge.class.current(), *edge.rank.current())
}

fn entries(graph: &Graph) -> Vec<f64> {
    let mut positions: Vec<_> = graph
        .live_nodes()
        .map(|id| graph.node(id))
        .filter(|node| *node.kind.current() == NodeKind::TownEntry)
        .map(|node| node.position.x)
        .collect();
    positions.sort_by(f64::total_cmp);
    positions
}

#[test]
fn a_small_town_keeps_the_crossing() {
    let mut writer = found_road();
    open_ring(&mut writer, 0, 30.0, Clock::ZERO);
    apply_fate(
        &mut writer,
        &phase("village", RoadFate::Kept),
        &charter(TownForm::Grown),
        Clock::ZERO,
    );
    let graph = writer.graph();
    assert_eq!(road_at(graph, 0.0), (EdgeClass::RegionalRoad, 1));
    assert_eq!(entries(graph), [-30.0, 30.0]);
    assert_eq!(
        road_result(graph),
        [RoadResult {
            id: ID.into(),
            entries: vec![point(-30.0, 0.0), point(30.0, 0.0)],
            kept: vec![(1170.0, 1230.0)],
            ended: vec![],
        }]
    );
}

#[test]
fn a_city_demotes_the_oldest_ring_and_ends_the_through_route_at_its_entries() {
    let mut writer = found_road();
    let charter = charter(TownForm::Grown);
    open_ring(&mut writer, 0, 30.0, Clock::ZERO);
    apply_fate(
        &mut writer,
        &phase("village", RoadFate::Kept),
        &charter,
        Clock::ZERO,
    );
    let clock = Clock::from_households(5_000.0);
    open_ring(&mut writer, 1, 100.0, clock);
    writer
        .apply(
            clock,
            EventKind::Promote {
                phase: 1,
                name: "city".into(),
            },
            vec![],
        )
        .unwrap();
    apply_fate(
        &mut writer,
        &phase("city", RoadFate::Demoted),
        &charter,
        clock,
    );
    let graph = writer.graph();
    assert_eq!(road_at(graph, 0.0), (EdgeClass::Street, 2));
    assert_eq!(road_at(graph, 60.0), (EdgeClass::Street, 1));
    assert_eq!(road_at(graph, 130.0), (EdgeClass::RegionalRoad, 1));
    assert_eq!(entries(graph), [-100.0, 100.0]);
    assert_eq!(
        road_result(graph),
        [RoadResult {
            id: ID.into(),
            entries: vec![point(-100.0, 0.0), point(100.0, 0.0)],
            kept: vec![],
            ended: vec![(1100.0, 1300.0)],
        }]
    );
    let centre = graph.edges_near(Level::Ground, CENTRE, 0.0)[0];
    assert_eq!(
        graph.edge(centre).class.at(Clock::ZERO),
        Some(&EdgeClass::RegionalRoad)
    );
    assert_eq!(graph.edge(centre).rank.at(Clock::ZERO), Some(&1));
}

#[test]
fn a_planned_town_keeps_connectivity_on_the_absorbed_axis() {
    let mut writer = found_road();
    open_ring(&mut writer, 0, 30.0, Clock::ZERO);
    let charter = charter(TownForm::Planned { capacity: 10_000 });
    apply_fate(
        &mut writer,
        &phase("town", RoadFate::Kept),
        &charter,
        Clock::ZERO,
    );
    assert_eq!(road_at(writer.graph(), 0.0), (EdgeClass::GridAxis, 1));
    assert_eq!(road_result(writer.graph())[0].kept, [(1170.0, 1230.0)]);
}
