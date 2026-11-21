use magna_urbis_geom::{Point, Shape, surface::TerrainView};

use super::{CostPath, Survey, SurveySpec};

const WIDTH: f64 = 1024.0;
const CENTER: Point = p(480.0, 512.0);
const PEAK: Point = p(560.0, 512.0);

struct Terrain {
    height: fn(Point) -> f64,
    water: fn(Point) -> Option<u8>,
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

    fn height_at(&self, point: Point) -> f64 {
        (self.height)(point)
    }

    fn wet(&self, point: Point) -> bool {
        !super::in_terrain(point, WIDTH) || (self.water)(point).is_some()
    }

    fn water_code(&self, point: Point) -> u8 {
        (self.water)(point).unwrap_or(0)
    }

    fn dry_clip(&self, _: &Shape) -> Vec<Shape> {
        panic!("terrain survey uses samples and does not clip polygons");
    }
}

const PLAIN: Terrain = Terrain {
    height: |_| 0.0,
    water: |_| None,
};

const RIVER: Terrain = Terrain {
    water: |q| (504.0..536.0).contains(&q.x).then_some(3),
    ..PLAIN
};

const COAST: Terrain = Terrain {
    water: |q| (q.x >= 608.0).then_some(1),
    ..PLAIN
};

const HILL: Terrain = Terrain {
    height: |q| 30.0 * (-0.5 * (q.distance(PEAK) / 105.0).powi(2)).exp(),
    ..PLAIN
};

const fn p(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn survey(terrain: &Terrain, center: Point, reach: f64, spec: &SurveySpec) -> Survey {
    Survey::new(terrain, center, reach, None, &[], spec).unwrap()
}

fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-8, "{a} differs from {b}");
}

#[test]
fn flat_costs_increase_with_distance_and_break_ties_by_cell_index() {
    let site = survey(&PLAIN, CENTER, 96.0, &SurveySpec::default());
    assert_eq!(site.center(), CENTER);
    assert_eq!(site.cell_size(), 8.0);
    near(site.cost_at(CENTER), 0.0);
    for i in 1..=8 {
        let d = f64::from(i) * 8.0;
        near(site.cost_at(p(CENTER.x + d, CENTER.y)), d);
        near(
            site.cost_at(p(CENTER.x + d, CENTER.y - d)),
            d * std::f64::consts::SQRT_2,
        );
    }
    let order: Vec<_> = site
        .cells_by_cost()
        .map(|(cell, cost)| (cost, cell.index))
        .collect();
    assert!(order.windows(2).all(|w| w[0] < w[1]));
    assert!(site.fronts().is_empty());
    assert!(site.strong_points().is_empty());
}

#[test]
fn terrace_costs_rise_and_cliffs_close_land_beyond_them() {
    let spec = SurveySpec::default();
    let terrace = Terrain {
        height: |q| 0.65 * q.x,
        ..PLAIN
    };
    let site = survey(&terrace, CENTER, 96.0, &spec);
    near(site.cost_at(p(504.0, 512.0)), 48.0);

    let escarpment = Terrain {
        height: |q| 2.0 * (q.x - 520.0).clamp(0.0, 16.0),
        ..PLAIN
    };
    let site = survey(&escarpment, CENTER, 112.0, &spec);
    assert!(site.cell_at(p(520.0, 512.0)).unwrap().slope_break);
    assert!(site.cell_at(p(528.0, 512.0)).unwrap().cliff);
    assert!(site.closed_at(p(528.0, 512.0)));
    assert!(site.cost_at(p(528.0, 512.0)).is_infinite());
    assert!(!site.closed_at(p(552.0, 512.0)));
    assert!(site.cost_at(p(552.0, 512.0)).is_infinite());
}

#[test]
fn slope_lowers_density_and_terraces_steep_land_without_closing_it() {
    let spec = SurveySpec::default();
    let flat = survey(&PLAIN, CENTER, 96.0, &spec);
    let cell = flat.cell_at(CENTER).unwrap();
    near(flat.slope_density(cell), 1.0);
    assert!(!flat.terraced(cell));

    let ramp = Terrain {
        height: |q| 0.25 * q.x,
        ..PLAIN
    };
    let site = survey(&ramp, CENTER, 96.0, &spec);
    let cell = site.cell_at(CENTER).unwrap();
    assert!(!cell.closed && site.terraced(cell));
    let density = site.slope_density(cell);
    assert!(
        spec.terrace_density < density && density < 1.0,
        "density {density}"
    );
    let quarter = site.quarter_slope(&magna_urbis_geom::rectangle(440.0, 472.0, 520.0, 552.0));
    assert!((quarter.mean_grade - 0.25).abs() < 1e-6);
    assert!(quarter.terraced());
    assert!((quarter.density - density).abs() < 1e-9);
}

#[test]
fn neighbour_claims_respect_holes_and_the_radius_is_exact_at_a_query_point() {
    let claim = Shape {
        outer: vec![
            p(494.0, 492.0),
            p(530.0, 492.0),
            p(530.0, 532.0),
            p(494.0, 532.0),
        ],
        holes: vec![vec![
            p(508.0, 506.0),
            p(518.0, 506.0),
            p(518.0, 518.0),
            p(508.0, 518.0),
        ]],
    };
    let site = Survey::new(
        &PLAIN,
        CENTER,
        96.0,
        Some(40.0),
        &[claim],
        &SurveySpec::default(),
    )
    .unwrap();
    assert!(site.closed_at(p(504.0, 512.0)));
    assert!(!site.closed_at(p(512.0, 512.0)));
    assert!(site.cost_at(p(512.0, 512.0)).is_infinite());
    assert!(!site.closed_at(p(440.0, 512.0)));
    assert!(site.closed_at(p(439.0, 512.0)));
    assert!(site.cost_at(p(439.0, 512.0)).is_infinite());
}

#[test]
fn bank_ids_are_the_minimum_cell_indices_even_when_masks_change() {
    let spec = SurveySpec::default();
    let site = survey(&RIVER, CENTER, 160.0, &spec);
    let smaller = Survey::new(&RIVER, CENTER, 160.0, Some(24.0), &[], &spec).unwrap();
    let far = p(568.0, 512.0);
    let near = site.bank_id_at(CENTER).unwrap();
    let distant = site.bank_id_at(far).unwrap();
    assert_ne!(near, distant);
    assert_eq!(smaller.bank_id_at(CENTER), Some(near));
    assert_eq!(smaller.bank_id_at(far), Some(distant));
    assert!(smaller.closed_at(far));
    for id in [near, distant] {
        let minimum = site
            .cells()
            .filter(|cell| cell.bank_id == Some(id))
            .map(|cell| cell.index)
            .min();
        assert_eq!(minimum, Some(id));
    }
    let water = site.cell_at(p(520.0, 512.0)).unwrap();
    assert!(water.wet && water.navigable && water.closed);
    assert_eq!(water.water_code, 3);
    assert_eq!(water.bank_id, None);
}

#[test]
fn unclassified_water_uses_wet_run_width() {
    let spec = SurveySpec::default();
    let wide = Terrain {
        water: |q| (504.0..536.0).contains(&q.x).then_some(0),
        ..PLAIN
    };
    let narrow = Terrain {
        water: |q| (518.0..522.0).contains(&q.x).then_some(0),
        ..PLAIN
    };
    let point = p(520.0, 512.0);
    let wide = survey(&wide, CENTER, 96.0, &spec);
    let narrow = survey(&narrow, CENTER, 96.0, &spec);
    assert!(wide.cell_at(point).unwrap().navigable);
    assert!(narrow.cell_at(point).unwrap().wet);
    assert!(!narrow.cell_at(point).unwrap().navigable);
}

#[test]
fn a_cheap_chain_lowers_costs_without_changing_the_initial_field() {
    let site = survey(&PLAIN, CENTER, 96.0, &SurveySpec::default());
    let end = p(544.0, 512.0);
    let path = [CENTER, p(504.0, 512.0), end];
    let field = site.recompute_costs(&[CostPath {
        points: &path,
        multiplier: 0.5,
        allow_crossings: false,
    }]);
    near(site.cost_at(end), 64.0);
    near(field.cost_at(end), 32.0);
    near(
        field.cost_at(p(544.0, 520.0)),
        28.0 + 8.0 * std::f64::consts::SQRT_2,
    );
}

#[test]
fn an_explicit_crossing_opens_a_far_bank_for_one_charge() {
    let spec = SurveySpec::default();
    let site = survey(&RIVER, CENTER, 160.0, &spec);
    let far = p(568.0, 512.0);
    let points = [CENTER, p(520.0, 512.0), far];
    let mut path = CostPath {
        points: &points,
        multiplier: 0.5,
        allow_crossings: false,
    };
    assert!(site.cost_at(far).is_infinite());
    assert!(site.recompute_costs(&[path]).cost_at(far).is_infinite());
    path.allow_crossings = true;
    let field = site.recompute_costs(&[path]);
    near(field.cost_at(far), 44.0 + spec.water_charge);
    assert!(field.cost_at(p(520.0, 512.0)).is_infinite());
    assert!(field.cells_by_cost().all(|(cell, _)| !cell.closed));
}

#[test]
fn a_gentle_coast_has_a_front_with_a_station_and_dry_land_distance() {
    let spec = SurveySpec {
        harbour_reach: 200.0,
        ..SurveySpec::default()
    };
    let site = survey(&COAST, CENTER, 224.0, &spec);
    let [front] = site.fronts() else {
        panic!("expected one front on a straight gentle coast");
    };
    assert_eq!(Some(front.bank_id), site.bank_id_at(CENTER));
    assert!(front.station > 0.0);
    assert!(front.length >= spec.harbour_min_front);
    assert!(
        front
            .shore
            .iter()
            .all(|&point| point.distance(CENTER) <= spec.harbour_reach)
    );
    assert!(front.shore.first().unwrap().y < front.shore.last().unwrap().y);
    assert!((127.9..128.1).contains(&front.land_distance.unwrap()));
    assert!(!front.sheltered);

    let closer = SurveySpec {
        harbour_reach: 150.0,
        ..spec.clone()
    };
    let shorter = survey(&COAST, CENTER, 224.0, &closer);
    assert!(shorter.fronts()[0].station > front.station);
    assert!(shorter.fronts()[0].length < front.length);
    let too_short = SurveySpec {
        harbour_min_front: 400.0,
        ..spec
    };
    assert!(
        survey(&COAST, CENTER, 224.0, &too_short)
            .fronts()
            .is_empty()
    );
}

#[test]
fn a_cliff_behind_the_bank_excludes_a_harbour_front() {
    let cliff_coast = Terrain {
        height: |q| 1.6 * (592.0 - q.x).max(0.0),
        ..COAST
    };
    let site = survey(&cliff_coast, CENTER, 224.0, &SurveySpec::default());
    assert!(!site.cell_at(p(600.0, 512.0)).unwrap().cliff);
    assert!(site.fronts().is_empty());
}

#[test]
fn a_cove_has_more_shelter_than_an_exposed_coast() {
    let cove = Terrain {
        water: |q| (q.x >= 860.0 || q.x >= 608.0 && (392.0..632.0).contains(&q.y)).then_some(1),
        ..PLAIN
    };
    let spec = SurveySpec {
        harbour_reach: 160.0,
        ..SurveySpec::default()
    };
    let open = survey(&COAST, CENTER, 224.0, &spec);
    let protected = survey(&cove, CENTER, 224.0, &spec);
    assert!(protected.fronts()[0].shelter_score > open.fronts()[0].shelter_score);
}

#[test]
fn a_prominent_level_hill_requires_a_lane_grade_approach() {
    let start = p(384.0, 512.0);
    let spec = SurveySpec::default();
    let site = survey(&HILL, start, 300.0, &spec);
    let [summit] = site.strong_points() else {
        panic!("expected one strong point on the hill");
    };
    assert_eq!(summit.position, PEAK);
    assert!(summit.prominence >= spec.strong_point_min_prominence);
    assert!(summit.top_area >= spec.strong_point_min_top_area);
    assert!(summit.access_slope > 0.0 && summit.access_slope <= spec.lane_grade);
    assert!(site.cell_at(PEAK).unwrap().crest);

    let inaccessible = SurveySpec {
        lane_grade: 0.0001,
        ..spec
    };
    assert!(
        survey(&HILL, start, 300.0, &inaccessible)
            .strong_points()
            .is_empty()
    );
}
