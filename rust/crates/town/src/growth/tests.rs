use std::collections::BTreeMap;

use magna_urbis_geom::{Point, Shape, area, contains, interior_point, surface::TerrainView};

use super::{Capacity, CapacityBlock, CapacityInputs, Verdict, run, verdict};
use crate::charter::PlannedSetting;
use crate::export::TownPlan;
use crate::graph::{Clock, Graph, Key};
use crate::journal::{Event, EventKind};
use crate::spec::{
    CharterSpec, CircumstanceModifiers, DefensiveShares, ExtensionHabit, FossilRule,
    FoundingFocusKind, GrowthSpec, HarbourEnclosure, HarbourSpec, HarbourThresholds, PhaseSpec,
    ProgrammeThresholds, RoadFate, SurveySpec, TissueSpec, TownSpecs, WallKind, WallSpec,
};
use crate::tissue::organic::OrganicParams;
use crate::walls::Purpose;
use crate::{RegionalRoad, TownRequest, TownSite};

const WIDTH: f64 = 2048.0;
const CENTRE: Point = point(1024.0, 1024.0);
/// Square metres of block per household at full occupation.
const LAND_PER_HOUSEHOLD: f64 = 150.0;
/// Inhabitants per household in these specs.
const HOUSEHOLD: f64 = 4.0;

const fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

/// A dry plain, cut to an island when `island` gives the radius of its shore around the centre,
/// to a coast when `sea` gives the abscissa the sea begins at, and by a river running north to
/// south between the two abscissae of `river`.
#[derive(Default)]
struct Terrain {
    island: Option<f64>,
    sea: Option<f64>,
    river: Option<[f64; 2]>,
}

impl Terrain {
    fn in_river(&self, p: Point) -> bool {
        self.river.is_some_and(|[a, b]| (a..b).contains(&p.x))
    }
}

impl TerrainView for Terrain {
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
        10.0
    }
    fn wet(&self, p: Point) -> bool {
        !(0.0..WIDTH).contains(&p.x)
            || !(0.0..WIDTH).contains(&p.y)
            || self.island.is_some_and(|r| p.distance(CENTRE) > r)
            || self.sea.is_some_and(|x| p.x >= x)
            || self.in_river(p)
    }
    fn water_code(&self, p: Point) -> u8 {
        match (self.wet(p), self.in_river(p)) {
            (false, _) => 0,
            (true, true) => 3,
            (true, false) => 1,
        }
    }
    fn dry_clip(&self, shape: &Shape) -> Vec<Shape> {
        vec![shape.clone()]
    }
}

/// Households in proportion to buildable land and occupation.
struct ByArea;

impl Capacity for ByArea {
    fn households(&self, blocks: &[CapacityBlock], inputs: CapacityInputs<'_>) -> f64 {
        let land: f64 = blocks.iter().map(|b| area(&b.outline)).sum();
        land / LAND_PER_HOUSEHOLD * inputs.fill_level
    }
}

fn phase(name: &str, threshold: u32) -> PhaseSpec {
    PhaseSpec {
        name: name.into(),
        threshold,
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
        wall_kind: None,
        wall_styles: Vec::new(),
        walls_when_grown: false,
        precinct_step: 1.5,
        precinct_gain: 0.3,
        precinct_step_spread: 0.0,
        precinct_gain_spread: 0.0,
        fossil_rule: FossilRule::Keep,
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
    }
}

fn specs() -> TownSpecs {
    TownSpecs {
        charter: CharterSpec {
            founding_rule: vec![FoundingFocusKind::RoadCrossing, FoundingFocusKind::Site],
            founding_cohort: 600,
            planned_founding_cohort: 0,
            planned_share: 0.0,
            village_tissue_id: "organic".into(),
            planned_tissue_id: "organic".into(),
            defensive_shares: DefensiveShares {
                enclosed_from_founding: 0.0,
                walled_when_grown: 0.0,
            },
            defensive_by_archetype: BTreeMap::new(),
            strong_point_share: 0.0,
            regional_road_reach: 160.0,
            ford_max_span: 10.0,
            bridge_max_span: 48.0,
            steep_grade: 0.18,
        },
        phases: vec![phase("hamlet", 0), phase("village", 300)],
        tissues: vec![TissueSpec {
            id: "organic".into(),
            pattern: "organic".into(),
            recipe: "core".into(),
            zone: "core".into(),
            parameters: BTreeMap::new(),
            organic: Some(OrganicParams::default()),
        }],
        wall: WallSpec {
            stiffness: 0.5,
            terrain_adherence: 0.0,
            crest_limit: 12.0,
            style: "curtain".into(),
            enclosure_shape: "organic".into(),
            keeps_citadel: false,
        },
        survey: SurveySpec::default(),
        harbour: HarbourSpec {
            enclosure_habit: HarbourEnclosure::HarbourOutside,
            quay_per_sqrt_pop: 6.0,
            thresholds: HarbourThresholds {
                landing: 0,
                piers: None,
                moles: None,
                basins: None,
            },
            works: Default::default(),
        },
        growth: GrowthSpec {
            reach: 600.0,
            household_size: HOUSEHOLD,
            ..GrowthSpec::default()
        },
        precinct: Default::default(),
        crossing: Default::default(),
    }
}

/// An enclosed village: every town of these specs is enclosed from founding, in palisades.
fn walled_specs() -> TownSpecs {
    let mut specs = specs();
    specs.charter.defensive_shares.enclosed_from_founding = 1.0;
    for phase in &mut specs.phases {
        phase.wall_kind = Some(WallKind::Palisade);
    }
    specs
}

/// A port town: it keeps a harbour on the best front within reach.
fn port_specs() -> TownSpecs {
    let mut specs = specs();
    specs.harbour.works.port_town = true;
    specs
}

fn lines(lines: &[[Point; 2]]) -> Vec<RegionalRoad> {
    lines
        .iter()
        .enumerate()
        .map(|(i, [a, b])| RegionalRoad::from_polyline(format!("road:{i}"), vec![*a, *b], 0))
        .collect()
}

/// Two regional roads crossing near the centre.
fn roads() -> Vec<RegionalRoad> {
    lines(&[
        [point(300.0, 1034.0), point(1750.0, 1010.0)],
        [point(1016.0, 300.0), point(1040.0, 1760.0)],
    ])
}

/// Two regional roads crossing near the centre, both kept off a sea east of x = 1300.
fn inland_roads() -> Vec<RegionalRoad> {
    lines(&[
        [point(300.0, 1034.0), point(1200.0, 1020.0)],
        [point(1016.0, 300.0), point(1040.0, 1760.0)],
    ])
}

fn request<'a>(
    specs: &'a TownSpecs,
    terrain: &'a Terrain,
    roads: &'a [RegionalRoad],
) -> TownRequest<'a> {
    TownRequest {
        site: TownSite {
            center: CENTRE,
            pinned: false,
            radius: None,
            population: 0,
            culture: "test-culture".into(),
            archetype: None,
        },
        specs,
        terrain,
        regional_roads: roads,
        neighbour_claims: &[],
        seed: "growth-test",
        planned: PlannedSetting::Auto,
        harbour_landing: None,
    }
}

/// Grow with `specs` on `terrain` along `roads` to `target` households, resuming `from` when
/// given.
fn grow_with(
    specs: &TownSpecs,
    terrain: &Terrain,
    roads: &[RegionalRoad],
    target: Clock,
    from: Option<&TownPlan>,
) -> TownPlan {
    let request = request(specs, terrain, roads);
    run(&request, &ByArea, target, from.map(|p| &p.stop.checkpoint)).unwrap()
}

/// Grow on `terrain` to `target` households, resuming `from` when given.
fn grow(terrain: &Terrain, target: Clock, from: Option<&TownPlan>) -> TownPlan {
    grow_with(&specs(), terrain, &roads(), target, from)
}

fn households(h: f64) -> Clock {
    Clock::from_households(h)
}

fn events(plan: &TownPlan) -> &[Event] {
    &plan.stop.checkpoint.journal.events
}

/// Live keys of every table, sorted.
fn keys(graph: &Graph) -> [Vec<Key>; 3] {
    let mut nodes: Vec<Key> = graph
        .live_nodes()
        .map(|n| graph.node(n).key.clone())
        .collect();
    let mut edges: Vec<Key> = graph
        .live_edges()
        .map(|e| graph.edge(e).key.clone())
        .collect();
    let mut faces: Vec<Key> = graph
        .live_faces()
        .map(|f| graph.face(f).key.clone())
        .collect();
    nodes.sort();
    edges.sort();
    faces.sort();
    [nodes, edges, faces]
}

fn assert_same(a: &TownPlan, b: &TownPlan) {
    assert_eq!(events(a), events(b), "journals differ");
    assert_eq!(keys(&a.graph), keys(&b.graph), "graph keys differ");
    assert_eq!(a.clock, b.clock);
    assert_eq!(a.stop.phase, b.stop.phase);
    assert_eq!(a.stop.records, b.stop.records);
    assert_eq!(a.stop.checkpoint.cursor, b.stop.checkpoint.cursor);
}

fn assert_prefix(short: &TownPlan, long: &TownPlan) {
    let n = events(short).len();
    assert!(n <= events(long).len());
    assert_eq!(events(short), &events(long)[..n], "not a prefix");
}

/// The first event satisfying `test`, with its position.
fn first(plan: &TownPlan, test: impl Fn(&EventKind) -> bool) -> (usize, Clock) {
    let i = events(plan)
        .iter()
        .position(|e| test(&e.kind))
        .expect("event present");
    (i, events(plan)[i].clock)
}

/// The latest date of the events before event `i` that are dated before it: a town grown to it
/// stops before the step that led to event `i`.
fn date_before(plan: &TownPlan, i: usize) -> Clock {
    let at = events(plan)[i].clock;
    events(plan)[..i]
        .iter()
        .rev()
        .map(|e| e.clock)
        .find(|&c| c < at)
        .unwrap_or(Clock::ZERO)
}

/// Stop on either side of the first event satisfying `test` in `direct`, check both stops are
/// prefixes that fall where they should, and that both resume to `direct`.
fn stops_around(
    specs: &TownSpecs,
    terrain: &Terrain,
    roads: &[RegionalRoad],
    direct: &TownPlan,
    test: impl Fn(&EventKind) -> bool,
) {
    let (i, at) = first(direct, test);
    let target = direct.stop.target;
    let before = grow_with(specs, terrain, roads, date_before(direct, i), None);
    let after = grow_with(specs, terrain, roads, at, None);
    assert_prefix(&before, direct);
    assert_prefix(&after, direct);
    assert!(events(&before).len() <= i, "stopped after the event");
    assert!(events(&after).len() > i, "stopped before the event");
    assert_same(&grow_with(specs, terrain, roads, target, Some(&before)), direct);
    assert_same(&grow_with(specs, terrain, roads, target, Some(&after)), direct);
}

const FAR: f64 = 600.0;

#[test]
fn resuming_a_stopped_town_matches_growing_it_directly() {
    let plain = Terrain::default();
    let small = grow(&plain, households(150.0), None);
    assert!(
        !small.quarters.is_empty(),
        "the small town opened no quarter"
    );
    assert!(small.clock >= households(150.0));
    let direct = grow(&plain, households(FAR), None);
    let resumed = grow(&plain, households(FAR), Some(&small));
    assert!(direct.clock > small.clock);
    assert_prefix(&small, &direct);
    assert_same(&resumed, &direct);
}

#[test]
fn stops_on_either_side_of_an_ageing_step_resume_alike() {
    let plain = Terrain::default();
    let direct = grow(&plain, households(FAR), None);
    let (i, at) = first(&direct, |k| matches!(k, EventKind::AgeQuarter { .. }));
    let before = grow(&plain, at, None);
    let after = grow(&plain, Clock(at.0 + 1), None);
    assert_prefix(&before, &direct);
    assert_prefix(&after, &direct);
    assert!(events(&before).len() <= i, "stopped after the ageing step");
    assert!(events(&after).len() > i, "stopped before the ageing step");
    assert_same(&grow(&plain, households(FAR), Some(&before)), &direct);
    assert_same(&grow(&plain, households(FAR), Some(&after)), &direct);
}

#[test]
fn stops_on_either_side_of_a_promotion_resume_alike() {
    let plain = Terrain::default();
    let direct = grow(&plain, households(FAR), None);
    let (i, at) = first(&direct, |k| matches!(k, EventKind::Promote { .. }));
    // The promotion follows the count that crossed its threshold: stopping when the clock
    // reaches the date of the event before it stops before that count.
    let before = grow(&plain, date_before(&direct, i), None);
    let after = grow(&plain, at, None);
    assert_prefix(&before, &direct);
    assert_prefix(&after, &direct);
    assert!(events(&before).len() < i, "stopped after the promotion");
    assert!(events(&after).len() > i, "stopped before the promotion");
    assert_eq!(before.stop.phase, 0);
    assert_eq!(after.stop.phase, 1);
    assert_same(&grow(&plain, households(FAR), Some(&before)), &direct);
    assert_same(&grow(&plain, households(FAR), Some(&after)), &direct);
}

#[test]
fn an_island_runs_out_of_land_and_ages_its_core_to_the_last_step() {
    let island = Terrain {
        island: Some(190.0),
        ..Terrain::default()
    };
    let plan = grow(&island, households(5000.0), None);
    assert!(!plan.quarters.is_empty());
    assert!(plan.clock < plan.stop.target);
    assert!(
        plan.warnings.iter().any(|w| w.starts_with("Out of land")),
        "{:?}",
        plan.warnings
    );
    for quarter in &plan.stop.records {
        assert_eq!(
            quarter.step,
            quarter.levels.len() - 1,
            "{:?} not fully aged",
            quarter.key
        );
    }
}

#[test]
fn the_ninety_percent_rule_reopens_once() {
    assert_eq!(verdict(100.0, 100.0, false), Verdict::Housed);
    assert!(matches!(verdict(92.0, 100.0, false), Verdict::Short(_)));
    assert_eq!(
        verdict(80.0, 100.0, false),
        Verdict::Reopen { missing: 20.0 }
    );
    assert!(matches!(verdict(80.0, 100.0, true), Verdict::Short(_)));
}

/// Households of the quarters whose land lies within `circuit`, and of all quarters.
fn housed_within(plan: &TownPlan, circuit: &Shape) -> (f64, f64) {
    let graph = &plan.graph;
    plan.quarters.iter().fold((0.0, 0.0), |(inside, total), q| {
        let households = q.population / HOUSEHOLD;
        let within = q
            .faces
            .iter()
            .filter_map(|&f| graph.outline(f))
            .next()
            .is_some_and(|s| contains(circuit, interior_point(&s)));
        (inside + if within { households } else { 0.0 }, total + households)
    })
}

#[test]
fn an_enclosed_village_of_a_thousand_raises_its_wall_round_most_households() {
    let (specs, plain, roads) = (walled_specs(), Terrain::default(), roads());
    let plan = grow_with(&specs, &plain, &roads, households(1000.0 / HOUSEHOLD), None);
    assert!(
        events(&plan)
            .iter()
            .any(|e| matches!(e.kind, EventKind::SurveyPrecinct { precinct: 0, .. })),
        "no founding precinct"
    );
    assert!(
        events(&plan)
            .iter()
            .any(|e| matches!(e.kind, EventKind::RaiseWall { .. })),
        "no wall raised"
    );
    let wall = plan
        .walls
        .iter()
        .find(|w| w.precinct.purpose == Purpose::Town && w.precinct.raised.is_some())
        .expect("a raised town wall");
    let (inside, total) = housed_within(&plan, &wall.precinct.enclosed);
    assert!(total > 0.0);
    assert!(
        inside / total >= 0.6,
        "{inside:.0} of {total:.0} households inside"
    );
}

#[test]
fn stops_on_either_side_of_a_wall_raise_resume_alike() {
    let (specs, plain, roads) = (walled_specs(), Terrain::default(), roads());
    let direct = grow_with(&specs, &plain, &roads, households(FAR), None);
    stops_around(&specs, &plain, &roads, &direct, |k| {
        matches!(k, EventKind::RaiseWall { .. })
    });
}

/// The sea begins 276 m east of the centre.
fn coast() -> Terrain {
    Terrain {
        sea: Some(1300.0),
        ..Terrain::default()
    }
}

#[test]
fn a_coast_town_grows_to_its_harbour_and_gets_a_quay() {
    let (specs, terrain, roads) = (port_specs(), coast(), inland_roads());
    let plan = grow_with(&specs, &terrain, &roads, households(FAR), None);
    assert!(
        events(&plan)
            .iter()
            .any(|e| matches!(e.kind, EventKind::OpenHarbour { .. })),
        "no harbour opened: {:?}",
        plan.warnings
    );
    assert!(
        plan.quays.iter().any(|q| q.role == "quay"),
        "no quay exported"
    );
}

#[test]
fn stops_on_either_side_of_a_harbour_opening_resume_alike() {
    let (specs, terrain, roads) = (port_specs(), coast(), inland_roads());
    let direct = grow_with(&specs, &terrain, &roads, households(FAR), None);
    stops_around(&specs, &terrain, &roads, &direct, |k| {
        matches!(k, EventKind::OpenHarbour { .. })
    });
}

#[test]
fn a_river_town_crosses_to_the_far_bank() {
    // A 24 m stream 150 m east of the centre, crossed by the east-west regional road. The far
    // bank is due once the near bank's cheapest land costs more than the crossing (after the
    // third ring here); the target lets the next ring open whole, whatever its station order.
    let terrain = Terrain {
        river: Some([1170.0, 1194.0]),
        ..Terrain::default()
    };
    let plan = grow(&terrain, households(2500.0), None);
    assert!(
        events(&plan)
            .iter()
            .any(|e| matches!(e.kind, EventKind::CrossWater { .. })),
        "no crossing: {:?}",
        plan.warnings
    );
    let far = plan.quarters.iter().any(|q| {
        q.faces
            .iter()
            .filter_map(|&f| plan.graph.outline(f))
            .any(|s| interior_point(&s).x > 1194.0)
    });
    assert!(far, "no quarter on the far bank");
}
