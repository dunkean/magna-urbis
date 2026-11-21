use super::*;
use crate::tissue::organic::{OrganicSite, split_quarter};
use magna_urbis_geom::rectangle;
use magna_urbis_random::Rng;
use std::f64::consts::PI;

const WIDTH: f64 = 2000.0;

/// Dry ground of the given height, 2 km square.
struct Ground {
    height: fn(Point) -> f64,
}

impl TerrainView for Ground {
    fn width(&self) -> f64 {
        WIDTH
    }
    fn height_resolution(&self) -> usize {
        1000
    }
    fn water_resolution(&self) -> usize {
        64
    }
    fn height_at(&self, p: Point) -> f64 {
        (self.height)(p)
    }
    fn wet(&self, p: Point) -> bool {
        !(p.x >= 0.0 && p.y >= 0.0 && p.x < WIDTH && p.y < WIDTH)
    }
    fn water_code(&self, _: Point) -> u8 {
        0
    }
    fn dry_clip(&self, shape: &Shape) -> Vec<Shape> {
        vec![shape.clone()]
    }
}

const FLAT: Ground = Ground { height: |_| 50.0 };
/// A 25 % slope rising north.
const SLOPE: Ground = Ground {
    height: |p| 50.0 + 0.25 * p.y,
};
/// A 90 % flank rising north, steeper than a flight of stairs.
const FLANK: Ground = Ground {
    height: |p| 50.0 + 0.9 * p.y,
};

fn params() -> OrganicParams {
    OrganicParams {
        allow_stairs: true,
        ..OrganicParams::default()
    }
}

fn site() -> OrganicSite {
    OrganicSite {
        centre: Point {
            x: 1000.0,
            y: 1000.0,
        },
        radius: 400.0,
        field: Rng::new("stairs-test").fork("town"),
    }
}

fn rng() -> Rng {
    Rng::new("stairs-test").fork("quarter")
}

/// Straight contour streets at each `y`, from `x0` to `x1`.
fn contour_streets(ys: &[f64], x0: f64, x1: f64) -> TissueDraft {
    TissueDraft {
        streets: ys
            .iter()
            .map(|&y| DraftStreet {
                path: vec![Point { x: x0, y }, Point { x: x1, y }],
                rank: 2,
                role: "street".into(),
                widths: vec![6.0, 6.0],
            })
            .collect(),
    }
}

fn ends(link: &DraftStreet) -> [Point; 2] {
    [link.path[0], link.path[link.path.len() - 1]]
}

/// Each link is stairs of rank 3 climbing from its first point; each flight within the stair
/// grade, the straight ones within the longest flight, the switchback ones within a flight's run.
fn check_flights(link: &DraftStreet, terrain: &Ground, params: &OrganicParams) {
    let rule = &params.slope.stairs;
    assert_eq!(link.role, "stairs");
    assert_eq!(link.rank, 3);
    assert_eq!(link.widths.len(), link.path.len());
    let [start, end] = ends(link);
    assert!(terrain.height_at(end) > terrain.height_at(start));
    let longest = if link.path.len() > 2 {
        rule.flight_length
    } else {
        rule.max_length
    };
    for w in link.path.windows(2) {
        let run = w[0].distance(w[1]);
        let grade = (terrain.height_at(w[1]) - terrain.height_at(w[0])).abs() / run;
        assert!(run <= longest + 1e-6, "a flight of {run:.1} m");
        assert!(
            grade <= params.max_stair_grade + 1e-6,
            "a flight at {:.0} %",
            grade * 100.0
        );
    }
}

/// No two links whose stretches up the slope (north) overlap by more than `overlap` metres
/// come closer than the spacing.
fn assert_spaced(links: &[DraftStreet], spacing: f64, overlap: f64) {
    let span = |l: &DraftStreet| {
        l.path
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
                (lo.min(p.y), hi.max(p.y))
            })
    };
    for (i, a) in links.iter().enumerate() {
        for b in &links[i + 1..] {
            let (sa, sb) = (span(a), span(b));
            if sa.1.min(sb.1) - sa.0.max(sb.0) > overlap {
                let d = path_distance(&a.path, &b.path);
                assert!(
                    d >= spacing - 1e-6,
                    "flights side by side {d:.1} m apart: {:?} and {:?}",
                    a.path,
                    b.path
                );
            }
        }
    }
}

#[test]
fn a_flat_quarter_gets_no_stairs() {
    let outline = rectangle(800.0, 990.0, 1400.0, 1110.0);
    let draft = contour_streets(&[1000.0, 1030.0, 1060.0, 1090.0], 800.0, 1400.0);
    assert!(stepped_links(&draft, &outline, &FLAT, &params()).is_empty());

    let square = rectangle(800.0, 800.0, 1200.0, 1200.0);
    let split = split_quarter(&square, &FLAT, &[], &site(), &params(), &mut rng());
    let draft = TissueDraft {
        streets: split.streets,
    };
    assert!(!draft.streets.is_empty());
    assert!(draft.streets.iter().all(|s| s.role != "stairs"));
    assert!(stepped_links(&draft, &square, &FLAT, &params()).is_empty());
}

#[test]
fn a_quarter_on_a_quarter_grade_gets_contour_streets_and_a_few_spaced_flights() {
    let outline = rectangle(800.0, 800.0, 1200.0, 1200.0);
    let params = params().terraced();
    let rule = &params.slope.stairs;
    let split = split_quarter(&outline, &SLOPE, &[], &site(), &params, &mut rng());
    let draft = TissueDraft {
        streets: split.streets,
    };
    assert!(
        draft.streets.iter().all(|s| s.role != "stairs"),
        "the split of a steep quarter lays no stairs"
    );
    // Most street length runs along the contours (east-west), within 20 degrees.
    let (mut along, mut total) = (0.0, 0.0);
    for s in &draft.streets {
        for w in s.path.windows(2) {
            let length = w[0].distance(w[1]);
            let heading = (w[1].y - w[0].y).atan2(w[1].x - w[0].x).rem_euclid(PI);
            if heading.min(PI - heading) < 20f64.to_radians() {
                along += length;
            }
            total += length;
        }
    }
    assert!(
        total > 0.0 && along / total > 0.5,
        "{:.0} % of street length along the contours",
        100.0 * along / total.max(1.0)
    );

    let links = stepped_links(&draft, &outline, &SLOPE, &params);
    assert!(!links.is_empty(), "no flight between contour streets");
    // Lower ends a spacing apart along each street or the outline bound the count.
    let fronts = (draft.streets.len() + 1) as f64;
    let bound = (total + 1600.0) / rule.spacing + fronts;
    assert!(
        (links.len() as f64) <= bound,
        "{} flights, more than {bound:.0}",
        links.len()
    );
    for link in &links {
        check_flights(link, &SLOPE, &params);
    }
    assert_spaced(&links, rule.spacing, 2.0 * CONTINUE);
}

#[test]
fn a_flank_too_steep_for_a_flight_is_climbed_by_a_switchback() {
    let outline = rectangle(800.0, 990.0, 1200.0, 1060.0);
    let draft = contour_streets(&[1000.0, 1048.0], 800.0, 1200.0);
    let params = params();
    let links = stepped_links(&draft, &outline, &FLANK, &params);
    let between = links.iter().find(|l| {
        let [start, end] = ends(l);
        l.path.len() >= 4 && (start.y - 1000.0).abs() < 1e-6 && (end.y - 1048.0).abs() < 1e-6
    });
    assert!(
        between.is_some(),
        "no switchback between the two streets: {links:?}"
    );
    for link in &links {
        assert!(link.path.len() >= 3, "a straight flight on a 90 % flank");
        check_flights(link, &FLANK, &params);
    }
    assert_spaced(&links, params.slope.stairs.spacing, CONTINUE + 1e-6);
}

#[test]
fn flights_are_never_side_by_side_nor_closer_than_the_spacing_along_a_street() {
    let outline = rectangle(800.0, 990.0, 1400.0, 1110.0);
    let draft = contour_streets(&[1000.0, 1030.0, 1060.0, 1090.0], 800.0, 1400.0);
    let params = params();
    let rule = &params.slope.stairs;
    let links = stepped_links(&draft, &outline, &SLOPE, &params);
    assert!(links.len() >= 2, "{} flights", links.len());
    for link in &links {
        check_flights(link, &SLOPE, &params);
    }
    assert_spaced(&links, rule.spacing, CONTINUE + 1e-6);
    // Along each street the ends of two flights are a spacing apart, or shared where one
    // flight continues the other up the slope.
    for (i, a) in links.iter().enumerate() {
        for b in &links[i + 1..] {
            for p in ends(a) {
                for q in ends(b) {
                    if (p.y - q.y).abs() < 1e-6 {
                        let d = p.distance(q);
                        assert!(
                            d < 1e-6 || d >= rule.spacing - 1e-6,
                            "two flights {d:.1} m apart on the street at y = {}",
                            p.y
                        );
                    }
                }
            }
        }
    }
}
