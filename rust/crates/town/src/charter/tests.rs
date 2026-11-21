use std::collections::BTreeMap;

use magna_urbis_geom::{Point, Shape, surface::TerrainView};

use super::{PhasePlan, PlannedSetting, effective_form, found};
use crate::{
    TownRequest, TownSite,
    spec::{
        CharterSpec, CircumstanceModifiers, DefensiveIntent, DefensiveShares, ExtensionHabit,
        FossilRule, FoundingFocusKind, HarbourEnclosure, HarbourSpec, HarbourThresholds, PhaseSpec,
        ProgrammeThresholds, RoadFate, SurveySpec, TownForm, TownSpecs, WallSpec,
    },
    survey::Survey,
};

const CENTER: Point = point(480.0, 512.0);

struct Terrain {
    coast: bool,
    grade: f64,
    river_width: f64,
}

impl TerrainView for Terrain {
    fn width(&self) -> f64 {
        1024.0
    }
    fn height_resolution(&self) -> usize {
        512
    }
    fn water_resolution(&self) -> usize {
        512
    }
    fn height_at(&self, p: Point) -> f64 {
        self.grade * p.x
    }
    fn wet(&self, p: Point) -> bool {
        self.water_code(p) > 0
    }
    fn water_code(&self, p: Point) -> u8 {
        if self.coast && p.x >= 608.0 {
            return 1;
        }
        if (p.x - 504.0).abs() < self.river_width * 0.5 {
            return 3;
        }
        0
    }
    fn dry_clip(&self, _: &Shape) -> Vec<Shape> {
        unreachable!()
    }
}

const PLAIN: Terrain = Terrain {
    coast: false,
    grade: 0.0,
    river_width: 0.0,
};
const COAST: Terrain = Terrain {
    coast: true,
    ..PLAIN
};
const STEEP: Terrain = Terrain {
    grade: 0.35,
    ..PLAIN
};
const RIVER: Terrain = Terrain {
    river_width: 32.0,
    ..PLAIN
};

const fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn specs() -> TownSpecs {
    let harbour_works = HarbourThresholds {
        landing: 0,
        piers: Some(2500),
        moles: None,
        basins: None,
    };
    let market = PhaseSpec {
        name: "market-town".into(),
        threshold: 1000,
        threshold_spread: 0.30,
        circumstance_modifiers: CircumstanceModifiers {
            road_crossing: 0.8,
            navigable_harbour: 0.85,
            isolated_site: 1.15,
            steep_site: 1.2,
        },
        tissue_id: "organic".into(),
        compact_tissue_id: "compact".into(),
        density: 80.0,
        compact_density: 150.0,
        fill_schedule: vec![0.6, 0.8, 1.0],
        wall_kind: None,
        wall_styles: Vec::new(),
        walls_when_grown: false,
        precinct_step: 1.5,
        precinct_gain: 0.3,
        precinct_step_spread: 0.1,
        precinct_gain_spread: 0.05,
        fossil_rule: FossilRule::Boulevard,
        extension_habit: ExtensionHabit::Lobes,
        road_fate: RoadFate::Kept,
        planned_road_fate: RoadFate::Absorbed,
        programme: ProgrammeThresholds {
            market: Some(1000),
            hall: None,
            cathedral: None,
        },
        harbour_works: harbour_works.clone(),
    };
    let hamlet = PhaseSpec {
        name: "hamlet".into(),
        threshold: 0,
        ..market.clone()
    };
    TownSpecs {
        charter: CharterSpec {
            founding_rule: vec![FoundingFocusKind::RoadCrossing, FoundingFocusKind::Site],
            founding_cohort: 600,
            planned_founding_cohort: 1200,
            planned_share: 0.0,
            village_tissue_id: "village".into(),
            planned_tissue_id: "grid".into(),
            defensive_shares: DefensiveShares {
                enclosed_from_founding: 0.1,
                walled_when_grown: 0.4,
            },
            defensive_by_archetype: BTreeMap::new(),
            strong_point_share: 0.0,
            regional_road_reach: 160.0,
            ford_max_span: 10.0,
            bridge_max_span: 48.0,
            steep_grade: 0.18,
        },
        phases: vec![hamlet, market],
        tissues: Vec::new(),
        wall: WallSpec {
            stiffness: 0.5,
            terrain_adherence: 0.0,
            crest_limit: 12.0,
            style: "curtain".into(),
            enclosure_shape: "organic".into(),
            keeps_citadel: false,
        },
        survey: SurveySpec {
            harbour_reach: 160.0,
            ..SurveySpec::default()
        },
        harbour: HarbourSpec {
            enclosure_habit: HarbourEnclosure::HarbourOutside,
            quay_per_sqrt_pop: 6.0,
            thresholds: harbour_works,
        },
    }
}

fn request<'a>(
    specs: &'a TownSpecs,
    terrain: &'a Terrain,
    roads: &'a [Vec<Point>],
    seed: &'a str,
) -> TownRequest<'a> {
    TownRequest {
        site: TownSite {
            center: CENTER,
            pinned: true,
            radius: None,
            population: 5000,
            culture: "test-culture".into(),
            archetype: None,
        },
        specs,
        terrain,
        regional_roads: roads,
        neighbour_claims: &[],
        seed,
        planned: PlannedSetting::Auto,
    }
}

fn survey(request: &TownRequest<'_>) -> Survey {
    Survey::from_request(request, 240.0).unwrap()
}

fn market_threshold(plan: &PhasePlan) -> u32 {
    plan.phases
        .iter()
        .find(|p| p.spec.name == "market-town")
        .unwrap()
        .threshold
}

#[test]
fn the_charter_is_stable_for_the_seed_and_grown_targets_above_the_cohort() {
    let specs = specs();
    let mut request = request(&specs, &PLAIN, &[], "stable");
    let survey = survey(&request);
    let first = found(&request, &survey).unwrap();
    assert_eq!(first, found(&request, &survey).unwrap());
    request.site.population = 25_000;
    assert_eq!(first, found(&request, &survey).unwrap());
}

#[test]
fn named_threshold_draws_depend_on_seed_and_stay_within_the_spread() {
    let specs = specs();
    let roads = [vec![point(410.0, 512.0), point(550.0, 512.0)]];
    let mut request = request(&specs, &PLAIN, &roads, "alpha");
    let survey = survey(&request);
    let (first, first_plan) = found(&request, &survey).unwrap();
    request.seed = "beta";
    let (second, second_plan) = found(&request, &survey).unwrap();
    let a = first.draws.phases["market-town"].promotion_threshold;
    let b = second.draws.phases["market-town"].promotion_threshold;
    assert_ne!(a, b);
    assert!((700..=1300).contains(&a));
    assert!((700..=1300).contains(&b));
    assert_eq!(market_threshold(&first_plan), a);
    assert_eq!(market_threshold(&second_plan), b);
    assert!(first_plan.promotion_after(0, a - 1).is_none());
    assert_eq!(
        first_plan.promotion_after(0, a).unwrap().spec.name,
        "market-town"
    );

    let mut extra_phase = specs.clone();
    extra_phase.phases.insert(
        1,
        PhaseSpec {
            name: "village".into(),
            threshold: 150,
            ..specs.phases[1].clone()
        },
    );
    request.specs = &extra_phase;
    let (with_village, _) = found(&request, &survey).unwrap();
    assert_eq!(
        second.draws.phases["market-town"],
        with_village.draws.phases["market-town"]
    );
}

#[test]
fn a_regional_crossing_brings_the_market_forward() {
    let specs = specs();
    let roads = [
        vec![point(390.0, 512.0), point(550.0, 512.0)],
        vec![point(495.0, 580.0), point(495.0, 512.0)],
    ];
    let mut request = request(&specs, &PLAIN, &roads[..1], "crossing");
    let survey = survey(&request);
    let (_, one_road) = found(&request, &survey).unwrap();
    request.regional_roads = &roads;
    let (with_crossing, plan) = found(&request, &survey).unwrap();
    assert_eq!(with_crossing.center, CENTER);
    assert_eq!(with_crossing.focus.position, point(495.0, 512.0));
    assert_eq!(with_crossing.focus.kind, FoundingFocusKind::RoadCrossing);
    assert_eq!(
        market_threshold(&plan),
        (f64::from(market_threshold(&one_road)) * 0.8).round() as u32
    );
}

#[test]
fn a_bridge_site_uses_a_regional_road_span_between_banks() {
    let specs = specs();
    let road = [vec![
        point(400.0, 512.0),
        point(504.0, 512.0),
        point(560.0, 512.0),
    ]];
    let mut request = request(&specs, &RIVER, &road, "bridge");
    request.site.archetype = Some("bridge".into());
    let (charter, _) = found(&request, &survey(&request)).unwrap();
    assert_eq!(charter.focus.kind, FoundingFocusKind::Bridge);
    assert!(RIVER.wet(charter.focus.position));
    assert_eq!(charter.focus.position.y, 512.0);
}

#[test]
fn a_harbour_culture_can_found_at_a_navigable_front_within_reach() {
    let mut specs = specs();
    specs
        .charter
        .founding_rule
        .insert(0, FoundingFocusKind::HarbourFront);
    let coastal = request(&specs, &COAST, &[], "harbour");
    let surveyed = survey(&coastal);
    let (charter, plan) = found(&coastal, &surveyed).unwrap();
    assert_eq!(charter.focus.kind, FoundingFocusKind::HarbourFront);
    let front = charter.harbour_front.unwrap();
    assert_eq!(charter.focus.position, front.position);
    assert!(front.position.distance(CENTER) <= specs.survey.harbour_reach);
    let raw = charter.draws.phases["market-town"].promotion_threshold;
    assert_eq!(
        market_threshold(&plan),
        (f64::from(raw) * 0.85).round() as u32
    );

    let dry_request = request(&specs, &PLAIN, &[], "harbour");
    let (dry, _) = found(&dry_request, &survey(&dry_request)).unwrap();
    assert_eq!(dry.focus.kind, FoundingFocusKind::Site);
}

#[test]
fn isolation_and_steep_ground_delay_the_market() {
    let specs = specs();
    let flat = request(&specs, &PLAIN, &[], "slope");
    let (charter, flat_plan) = found(&flat, &survey(&flat)).unwrap();
    let steep = request(&specs, &STEEP, &[], "slope");
    let (_, steep_plan) = found(&steep, &survey(&steep)).unwrap();
    let raw = f64::from(charter.draws.phases["market-town"].promotion_threshold);
    assert_eq!(market_threshold(&flat_plan), (raw * 1.15).round() as u32);
    assert_eq!(
        market_threshold(&steep_plan),
        (raw * (1.15 * 1.2)).round() as u32
    );
}

#[test]
fn below_the_planned_cohort_even_a_requested_frame_uses_the_village_form() {
    let mut specs = specs();
    specs.charter.planned_share = 1.0;
    let mut request = request(&specs, &PLAIN, &[], "planned");
    request.site.population = 1199;
    let survey = survey(&request);
    assert_eq!(effective_form(&request, &specs.charter), TownForm::Grown);
    request.planned = PlannedSetting::On {
        capacity: Some(10000),
    };
    let (small, small_plan) = found(&request, &survey).unwrap();
    assert_eq!(small.form, TownForm::Grown);
    assert_eq!(small.founding_tissue_id, "village");
    assert_eq!(small.focus.kind, FoundingFocusKind::Site);

    request.site.population = 1200;
    assert_eq!(
        effective_form(&request, &specs.charter),
        TownForm::Planned { capacity: 10000 }
    );
    let (planned, planned_plan) = found(&request, &survey).unwrap();
    assert_eq!(planned.focus.kind, FoundingFocusKind::PlannedFrame);
    assert_eq!(planned.founding_tissue_id, "grid");
    assert_eq!(
        market_threshold(&small_plan),
        market_threshold(&planned_plan)
    );
    request.site.population = 5000;
    assert_eq!(planned, found(&request, &survey).unwrap().0);
    request.planned = PlannedSetting::Auto;
    assert_eq!(
        effective_form(&request, &specs.charter),
        TownForm::Planned { capacity: 5000 }
    );
}

#[test]
fn the_request_archetype_can_prefer_a_front_and_enclosure() {
    let mut specs = specs();
    specs.charter.defensive_by_archetype.insert(
        "harbor".into(),
        DefensiveShares {
            enclosed_from_founding: 1.0,
            walled_when_grown: 0.0,
        },
    );
    let mut request = request(&specs, &COAST, &[], "archetype");
    let survey = survey(&request);
    assert_eq!(
        found(&request, &survey).unwrap().0.focus.kind,
        FoundingFocusKind::Site
    );
    request.site.archetype = Some("harbor".into());
    let (charter, _) = found(&request, &survey).unwrap();
    assert_eq!(charter.focus.kind, FoundingFocusKind::HarbourFront);
    assert_eq!(
        charter.defensive_intent,
        DefensiveIntent::EnclosedFromFounding
    );
}
