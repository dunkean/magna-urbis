use std::collections::BTreeMap;

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::*;
use crate::armature;
use crate::charter::{Charter, FoundingFocus, PlannedPhase};
use crate::graph::{Clock, EdgeClass, FaceKind, Key, Level, NodeKind};
use crate::journal::{EventKind, Op, Writer};
use crate::spec::{
    CircumstanceModifiers, DefensiveIntent, ExtensionHabit, FossilRule, FoundingFocusKind,
    HarbourEnclosure, HarbourThresholds, PhaseDraw, PhaseSpec, PrecinctSpec, ProgrammeThresholds,
    RoadFate, SurveySpec, TownDraws, TownForm, WallKind, WallSpec,
};
use crate::survey::{StrongPoint, Survey};

const WIDTH: f64 = 2048.0;
const CENTRE: Point = pt(1024.0, 1024.0);
const HOUSEHOLD: f64 = 3.7;

const fn pt(x: f64, y: f64) -> Point {
    Point { x, y }
}

struct Terrain {
    height: fn(Point) -> f64,
    wet: fn(Point) -> bool,
}

impl TerrainView for Terrain {
    fn width(&self) -> f64 {
        WIDTH
    }
    fn height_resolution(&self) -> usize {
        1024
    }
    fn water_resolution(&self) -> usize {
        512
    }
    fn height_at(&self, p: Point) -> f64 {
        (self.height)(p)
    }
    fn wet(&self, p: Point) -> bool {
        !(0.0..WIDTH).contains(&p.x) || !(0.0..WIDTH).contains(&p.y) || (self.wet)(p)
    }
    fn water_code(&self, p: Point) -> u8 {
        u8::from(self.wet(p))
    }
    fn dry_clip(&self, shape: &Shape) -> Vec<Shape> {
        g::intersection(shape, &g::rectangle(0.0, 0.0, WIDTH, WIDTH))
    }
}

const FLAT: Terrain = Terrain {
    height: |_| 10.0,
    wet: |_| false,
};

/// Sea south of y = 900.
const COAST: Terrain = Terrain {
    height: |_| 10.0,
    wet: |p| p.y < 900.0,
};

/// A 30 m knoll at the centre.
const KNOLL: Terrain = Terrain {
    height: |p| 30.0 * (-0.5 * ((p.x - 1024.0).powi(2) + (p.y - 1024.0).powi(2)) / 3600.0).exp(),
    wet: |_| false,
};

fn wall_spec() -> WallSpec {
    WallSpec {
        stiffness: 0.0,
        terrain_adherence: 0.0,
        crest_limit: 12.0,
        style: "palisade".into(),
        enclosure_shape: "organic".into(),
        keeps_citadel: false,
    }
}

fn draw() -> PhaseDraw {
    PhaseDraw {
        promotion_threshold: 0,
        wall_kind: Some(WallKind::Palisade),
        wall_style: None,
        precinct_step: 1.5,
        precinct_gain: 0.3,
        fossil_rule: FossilRule::Remove,
        extension_habit: ExtensionHabit::Lobes,
    }
}

fn phase() -> PlannedPhase {
    PlannedPhase {
        threshold: 0,
        spec: PhaseSpec {
            name: "village".into(),
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
            density: 80.0,
            compact_density: 150.0,
            fill_schedule: vec![0.6, 0.8, 1.0],
            wall_kind: Some(WallKind::Palisade),
            wall_styles: Vec::new(),
            walls_when_grown: false,
            precinct_step: 1.5,
            precinct_gain: 0.3,
            precinct_step_spread: 0.0,
            precinct_gain_spread: 0.0,
            fossil_rule: FossilRule::Remove,
            extension_habit: ExtensionHabit::Lobes,
            road_fate: RoadFate::Kept,
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
        },
    }
}

fn charter(centre: Point) -> Charter {
    Charter {
        culture: "test".into(),
        site_archetype: None,
        center: centre,
        pinned: false,
        radius: None,
        focus: FoundingFocus {
            kind: FoundingFocusKind::Site,
            position: centre,
        },
        harbour_front: None,
        form: TownForm::Grown,
        founding_cohort: 1000,
        founding_tissue_id: "organic".into(),
        defensive_intent: DefensiveIntent::EnclosedFromFounding,
        draws: TownDraws {
            phases: BTreeMap::from([("village".to_string(), draw())]),
            harbour_enclosure: HarbourEnclosure::SeaWall,
        },
    }
}

fn survey(terrain: &Terrain, centre: Point, claims: &[Shape]) -> Survey {
    Survey::new(terrain, centre, 900.0, None, claims, &SurveySpec::default()).expect("a survey")
}

/// A town founded at `centre` with its regional roads.
fn found(centre: Point, roads: &[Vec<Point>]) -> Writer {
    let mut writer = Writer::new(32.0);
    let kind = EventKind::Found {
        center: centre,
        focus: "site".into(),
    };
    let event = kind.key();
    let mut stage = writer.stage(Clock::ZERO);
    armature::regional_roads(&mut stage, &event, roads, centre, 900.0, 8.0);
    let ops = stage.into_ops();
    writer
        .apply(Clock::ZERO, kind, ops)
        .expect("the founding applies");
    writer
}

fn site<'a>(
    terrain: &'a Terrain,
    survey: &'a Survey,
    wall: &'a WallSpec,
    spec: &'a PrecinctSpec,
    claims: &'a [Shape],
    harbour: Option<&'a HarbourSide>,
) -> PrecinctSite<'a> {
    PrecinctSite {
        terrain,
        wall,
        spec,
        costs: survey.cost_field(),
        household_size: HOUSEHOLD,
        neighbour_claims: claims,
        main_chains: &[],
        harbour,
        castle: None,
    }
}

fn apply_survey(writer: &mut Writer, plan: &PrecinctPlan, clock: Clock) {
    let kind = EventKind::SurveyPrecinct {
        precinct: plan.precinct.index,
        step: 1.5,
    };
    writer
        .apply(clock, kind, plan.ops.clone())
        .expect("the survey applies");
}

fn east_west() -> Vec<Vec<Point>> {
    vec![vec![pt(150.0, 1024.0), pt(1900.0, 1024.0)]]
}

#[test]
fn an_enclosed_village_of_1000_gets_six_to_seven_hectares() {
    let writer = found(CENTRE, &east_west());
    let survey = survey(&FLAT, CENTRE, &[]);
    let (wall, spec) = (wall_spec(), PrecinctSpec::default());
    let site = site(&FLAT, &survey, &wall, &spec, &[], None);
    let plan = survey_precinct(
        &writer,
        &survey,
        &charter(CENTRE),
        &phase(),
        None,
        Clock::ZERO,
        Clock::ZERO,
        &site,
    )
    .expect("a founding precinct");
    let hectares = g::area(&plan.precinct.outline) / 10_000.0;
    assert!(
        (6.0..=7.4).contains(&hectares),
        "{hectares:.2} ha for 1,000 inhabitants at 150 per hectare"
    );
    assert!(plan.precinct.raised.is_none() && !plan.raise_now);
    assert!(plan.precinct.wall_street.is_some());
    let near = g::rectangle(1034.0, 1034.0, 1054.0, 1054.0);
    let far = g::rectangle(1500.0, 1500.0, 1520.0, 1520.0);
    assert!(plan.open_sectors.admits(&near) && !plan.open_sectors.admits(&far));
    let mut writer = writer;
    apply_survey(&mut writer, &plan, Clock::ZERO);
}

#[test]
fn a_gate_stands_on_each_regional_road_crossing() {
    let roads = vec![
        vec![pt(150.0, 1024.0), pt(1900.0, 1024.0)],
        vec![pt(1024.0, 150.0), pt(1024.0, 1900.0)],
    ];
    let mut writer = found(CENTRE, &roads);
    let survey = survey(&FLAT, CENTRE, &[]);
    let (wall, spec) = (wall_spec(), PrecinctSpec::default());
    let site = site(&FLAT, &survey, &wall, &spec, &[], None);
    let plan = survey_precinct(
        &writer,
        &survey,
        &charter(CENTRE),
        &phase(),
        None,
        Clock::ZERO,
        Clock::ZERO,
        &site,
    )
    .expect("a precinct");
    apply_survey(&mut writer, &plan, Clock::ZERO);
    let graph = writer.graph();
    let gates: Vec<&Gate> = plan
        .precinct
        .gates
        .iter()
        .filter(|x| x.route == Some(Route::Regional))
        .collect();
    assert_eq!(gates.len(), 4, "{:?}", plan.precinct.gates);
    for gate in gates {
        let node = graph.node_id(&gate.node).expect("the gate node");
        assert_eq!(*graph.node(node).kind.current(), NodeKind::Gate);
        assert!(
            (gate.position.x - 1024.0).abs() < 1e-6 || (gate.position.y - 1024.0).abs() < 1e-6,
            "gate off its road: {:?}",
            gate.position
        );
    }
}

#[test]
fn a_precinct_is_raised_only_when_full() {
    let mut writer = found(CENTRE, &east_west());
    let survey = survey(&FLAT, CENTRE, &[]);
    let (wall, spec) = (wall_spec(), PrecinctSpec::default());
    let site = site(&FLAT, &survey, &wall, &spec, &[], None);
    let plan = survey_precinct(
        &writer,
        &survey,
        &charter(CENTRE),
        &phase(),
        None,
        Clock::ZERO,
        Clock::ZERO,
        &site,
    )
    .expect("a precinct");
    apply_survey(&mut writer, &plan, Clock::ZERO);
    let precinct = plan.precinct;
    assert!(raise_when_full(writer.graph(), &precinct, &draw()).is_none());

    // The precinct's land faces, north and south of the road.
    let graph = writer.graph();
    let mut land: Vec<Key> = graph
        .live_faces()
        .filter(|&f| f != graph.outside(Level::Ground))
        .filter_map(|f| {
            let shape = graph.outline(f)?;
            (g::area(&shape) > 100.0 && g::contains(&precinct.land, g::interior_point(&shape)))
                .then(|| graph.face(f).key.clone())
        })
        .collect();
    land.sort();
    assert!(land.len() >= 2, "{} land faces", land.len());
    let block = |faces: &[Key]| -> Vec<Op> {
        faces
            .iter()
            .map(|face| Op::SetFaceKind {
                face: face.clone(),
                kind: FaceKind::Block,
            })
            .collect()
    };
    let age = |step: u32| EventKind::AgeQuarter {
        quarter: Key::node(&[77]),
        step,
    };
    writer
        .apply(Clock(1), age(1), block(&land[..1]))
        .expect("one face built");
    assert!(
        raise_when_full(writer.graph(), &precinct, &draw()).is_none(),
        "raised with land still open"
    );
    writer
        .apply(Clock(2), age(2), block(&land[1..]))
        .expect("every face built");
    let ops = raise_when_full(writer.graph(), &precinct, &draw()).expect("a full precinct rises");
    writer
        .apply(Clock(3), raise_event(&precinct, WallKind::Palisade), ops)
        .expect("the raise applies");
    let graph = writer.graph();
    let steps = graph.faces_along_chain(&precinct.chain);
    assert!(!steps.is_empty());
    assert!(
        steps
            .iter()
            .all(|s| *graph.edge(s.edge).class.current() == EdgeClass::Wall)
    );
}

#[test]
fn the_share_outside_stays_below_one_minus_one_over_step() {
    let draw = draw();
    let bound = 1.0 - 1.0 / draw.precinct_step;
    let (inside, mut outside) = (1000.0, 0.0);
    while !survey_due(inside, outside, inside, &draw) {
        assert!(outside_share(inside, outside) < bound);
        outside += 10.0;
        assert!(outside < 10_000.0, "the next survey never came");
    }
    assert!(outside_share(inside, outside) < bound);
    assert!(survey_due(
        1000.0 * (1.0 + draw.precinct_gain),
        0.0,
        1000.0,
        &draw
    ));
    assert!(!survey_due(1000.0, 0.0, 1000.0, &draw));
}

#[test]
fn a_castle_on_a_knoll_has_a_road_down_to_the_regional_road() {
    let roads = vec![vec![pt(150.0, 724.0), pt(1900.0, 724.0)]];
    let writer = found(CENTRE, &roads);
    let survey = survey(&KNOLL, CENTRE, &[]);
    let point = StrongPoint {
        position: CENTRE,
        top_area: 5000.0,
        prominence: 8.0,
        access_slope: 0.0,
        score: 25.0 + 1.5 * 8.0,
    };
    let mut stage = writer.stage(Clock::ZERO);
    let spec = PrecinctSpec::default();
    let (castle, warnings) = found_castle(
        &mut stage, &survey, &KNOLL, &point, 1000.0, &roads, 0.18, &spec,
    )
    .expect("a castle on the knoll");
    assert!(warnings.is_empty(), "{warnings:?}");
    assert!(
        g::contains(&castle.outline, CENTRE),
        "the castle crowns the knoll"
    );
    let road = castle.road.clone().expect("a castle road");
    let ops = stage.into_ops();
    let mut writer = writer;
    writer
        .apply(Clock::ZERO, EventKind::ExtendArmature { ring: 0 }, ops)
        .expect("the castle applies");
    let graph = writer.graph();
    let steps = graph.faces_along_chain(&road);
    assert!(!steps.is_empty());
    assert!(
        steps
            .iter()
            .all(|s| *graph.edge(s.edge).class.current() == EdgeClass::CastleRoad)
    );
    let reaches_road = steps.iter().any(|s| {
        graph
            .edge(s.edge)
            .nodes
            .iter()
            .any(|&n| (graph.node(n).position.y - 724.0).abs() < 1.0)
    });
    assert!(reaches_road, "the castle road ends on the regional road");
    let bailey = graph.face_at(Level::Ground, CENTRE);
    assert_eq!(*graph.face(bailey).kind.current(), FaceKind::Bailey);
    // Every step of the road keeps to lane grade.
    for s in &steps {
        for w in graph.edge(s.edge).polyline.windows(2) {
            let grade = (KNOLL.height_at(w[0]) - KNOLL.height_at(w[1])).abs() / w[0].distance(w[1]);
            assert!(grade <= 0.18 * 1.5, "a stretch at grade {grade:.2}");
        }
    }
}

#[test]
fn a_lobe_shares_its_stretch_with_the_old_wall() {
    // Neighbours west, north and south: the town can only grow east of its first precinct.
    let claims = vec![
        g::rectangle(0.0, 0.0, CENTRE.x - 100.0, WIDTH),
        g::rectangle(0.0, CENTRE.y + 250.0, WIDTH, WIDTH),
        g::rectangle(0.0, 0.0, WIDTH, CENTRE.y - 250.0),
    ];
    let mut writer = found(CENTRE, &east_west());
    let survey = survey(&FLAT, CENTRE, &claims);
    let wall = wall_spec();
    let spec = PrecinctSpec {
        neighbour_clearance: 0.0,
        ..PrecinctSpec::default()
    };
    let site = site(&FLAT, &survey, &wall, &spec, &claims, None);
    let charter = charter(CENTRE);
    let first = survey_precinct(
        &writer,
        &survey,
        &charter,
        &phase(),
        None,
        Clock::ZERO,
        Clock::ZERO,
        &site,
    )
    .expect("a first precinct");
    apply_survey(&mut writer, &first, Clock::ZERO);
    let second = survey_precinct(
        &writer,
        &survey,
        &charter,
        &phase(),
        Some(&first.precinct),
        Clock::from_households(600.0),
        Clock(10),
        &site,
    )
    .expect("a second precinct");
    assert_eq!(
        second.precinct.attached_to,
        Some(0),
        "{:?}",
        second.warnings
    );
    let shared: f64 = second
        .precinct
        .shared
        .iter()
        .map(|(p, q)| p.distance(*q))
        .sum();
    assert!(shared > 100.0, "shared stretch {shared:.0} m");
    apply_survey(&mut writer, &second, Clock(10));
    // The lobe's line starts and ends on the old precinct line.
    let graph = writer.graph();
    let old = &first.precinct.outline;
    let ends: Vec<Point> = graph
        .faces_along_chain(&second.precinct.chain)
        .iter()
        .flat_map(|s| graph.edge(s.edge).nodes)
        .map(|n| graph.node(n).position)
        .filter(|&p| {
            let n = old.outer.len();
            (0..n).any(|i| g::distance(p, old.outer[i], old.outer[(i + 1) % n]).0 < 1.6)
        })
        .collect();
    assert!(ends.len() >= 2, "the lobe does not meet the old line twice");
}

#[test]
fn a_sea_wall_has_a_water_gate_at_each_landing() {
    let centre = pt(1024.0, 1000.0);
    let mut writer = found(centre, &[]);
    let survey = survey(&COAST, centre, &[]);
    let (wall, spec) = (wall_spec(), PrecinctSpec::default());
    let landings = vec![pt(944.0, 905.0), pt(1024.0, 905.0), pt(1104.0, 905.0)];
    let harbour = HarbourSide {
        habit: HarbourEnclosure::SeaWall,
        quay: vec![pt(904.0, 905.0), pt(1144.0, 905.0)],
        landings: landings.clone(),
        approach: None,
        service_row: None,
        road: None,
    };
    let site = site(&COAST, &survey, &wall, &spec, &[], Some(&harbour));
    let plan = survey_precinct(
        &writer,
        &survey,
        &charter(centre),
        &phase(),
        None,
        Clock::ZERO,
        Clock::ZERO,
        &site,
    )
    .expect("a precinct on the coast");
    apply_survey(&mut writer, &plan, Clock::ZERO);
    let graph = writer.graph();
    for landing in landings {
        let gate = plan
            .precinct
            .gates
            .iter()
            .find(|x| x.kind == NodeKind::WaterGate && x.position.distance(landing) < 25.0)
            .unwrap_or_else(|| panic!("no water gate at the landing {landing:?}"));
        let node = graph.node_id(&gate.node).expect("the water gate node");
        assert_eq!(*graph.node(node).kind.current(), NodeKind::WaterGate);
    }
    // The curtain keeps to the land side of the quay.
    assert!(
        plan.precinct
            .outline
            .outer
            .iter()
            .filter(|p| (904.0..=1144.0).contains(&p.x))
            .all(|p| p.y > 910.0),
        "the curtain runs on the quay"
    );
}
