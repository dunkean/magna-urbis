use std::collections::BTreeMap;

use magna_urbis_geom::{Point, Shape, area, surface::TerrainView};

use super::{Capacity, CapacityBlock, CapacityInputs, Verdict, run, verdict};
use crate::charter::PlannedSetting;
use crate::export::TownPlan;
use crate::graph::{Clock, Graph, Key};
use crate::journal::{Event, EventKind};
use crate::spec::{
    CharterSpec, CircumstanceModifiers, DefensiveShares, ExtensionHabit, FossilRule,
    FoundingFocusKind, GrowthSpec, HarbourEnclosure, HarbourSpec, HarbourThresholds, PhaseSpec,
    ProgrammeThresholds, RoadFate, SurveySpec, TissueSpec, TownSpecs, WallSpec,
};
use crate::tissue::organic::OrganicParams;
use crate::{TownRequest, TownSite};

const WIDTH: f64 = 2048.0;
const CENTRE: Point = point(1024.0, 1024.0);
/// Square metres of block per household at full occupation.
const LAND_PER_HOUSEHOLD: f64 = 150.0;

const fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

/// A dry plain, or an island when `island` gives the radius of its shore around the centre.
struct Terrain {
    island: Option<f64>,
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
    }
    fn water_code(&self, p: Point) -> u8 {
        if self.wet(p) { 1 } else { 0 }
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
        },
        growth: GrowthSpec {
            reach: 600.0,
            household_size: 4.0,
            ..GrowthSpec::default()
        },
    }
}

fn roads() -> Vec<Vec<Point>> {
    vec![
        vec![point(300.0, 1034.0), point(1750.0, 1010.0)],
        vec![point(1016.0, 300.0), point(1040.0, 1760.0)],
    ]
}

fn request<'a>(
    specs: &'a TownSpecs,
    terrain: &'a Terrain,
    roads: &'a [Vec<Point>],
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
    }
}

/// Grow on `terrain` to `target` households, resuming `from` when given.
fn grow(terrain: &Terrain, target: Clock, from: Option<&TownPlan>) -> TownPlan {
    let (specs, roads) = (specs(), roads());
    let request = request(&specs, terrain, &roads);
    run(&request, &ByArea, target, from.map(|p| &p.stop.checkpoint)).unwrap()
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

const FAR: f64 = 600.0;

#[test]
fn resuming_a_stopped_town_matches_growing_it_directly() {
    let plain = Terrain { island: None };
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
    let plain = Terrain { island: None };
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
    let plain = Terrain { island: None };
    let direct = grow(&plain, households(FAR), None);
    let (i, at) = first(&direct, |k| matches!(k, EventKind::Promote { .. }));
    // The promotion follows the count that crossed its threshold: stopping when the clock
    // reaches the date of the event before it stops before that count.
    let before = grow(&plain, events(&direct)[i - 1].clock, None);
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
