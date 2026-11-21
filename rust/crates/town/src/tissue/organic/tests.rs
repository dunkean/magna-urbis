use super::split::frame;
use super::*;
use magna_urbis_geom::{area, contains, distance, rectangle, segment_hit};
use std::f64::consts::FRAC_PI_2;

/// A dry plane rising by `gx` and `gy` per metre, 2 km square.
struct Ramp {
    gx: f64,
    gy: f64,
}

const WIDTH: f64 = 2000.0;

impl TerrainView for Ramp {
    fn width(&self) -> f64 {
        WIDTH
    }
    fn height_resolution(&self) -> usize {
        256
    }
    fn water_resolution(&self) -> usize {
        64
    }
    fn height_at(&self, p: Point) -> f64 {
        50.0 + self.gx * p.x + self.gy * p.y
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

fn site() -> OrganicSite {
    OrganicSite {
        centre: Point {
            x: 1000.0,
            y: 1000.0,
        },
        radius: 400.0,
        field: Rng::new("organic-tissue-test").fork("town"),
    }
}

fn square() -> Shape {
    rectangle(800.0, 800.0, 1200.0, 1200.0)
}

/// A star-shaped nonagon with a notch on its north side, counter-clockwise.
fn irregular() -> Shape {
    let points = [
        (780.0, 850.0),
        (950.0, 790.0),
        (1130.0, 820.0),
        (1230.0, 960.0),
        (1180.0, 1120.0),
        (1060.0, 1150.0),
        (1000.0, 1080.0),
        (900.0, 1210.0),
        (790.0, 1080.0),
    ];
    Shape {
        outer: points.iter().map(|&(x, y)| Point { x, y }).collect(),
        holes: vec![],
    }
}

/// A road along the south of both outlines and one arriving from the south.
fn armature() -> Vec<Vec<Point>> {
    vec![
        vec![
            Point { x: 600.0, y: 780.0 },
            Point {
                x: 1400.0,
                y: 780.0,
            },
        ],
        vec![
            Point {
                x: 1000.0,
                y: 400.0,
            },
            Point {
                x: 1000.0,
                y: 780.0,
            },
        ],
    ]
}

fn ring_distance(s: &Shape, p: Point) -> f64 {
    std::iter::once(&s.outer)
        .chain(&s.holes)
        .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
        .map(|(&a, &b)| distance(p, a, b).0)
        .fold(f64::INFINITY, f64::min)
}

fn path_distance(path: &[Point], p: Point) -> f64 {
    path.windows(2)
        .map(|w| distance(p, w[0], w[1]).0)
        .fold(f64::INFINITY, f64::min)
}

fn near_end(path: &[Point], p: Point, tolerance: f64) -> bool {
    p.distance(path[0]) < tolerance || p.distance(*path.last().unwrap()) < tolerance
}

fn run(outline: &Shape, terrain: &Ramp, roads: &[Vec<Point>]) -> (OrganicSplit, OrganicParams) {
    let params = OrganicParams::default();
    let split = split_quarter(
        outline,
        terrain,
        roads,
        &site(),
        &params,
        &mut Rng::new("organic-tissue-test").fork("quarter"),
    );
    (split, params)
}

/// The invariants of a draft: streets inside the outline, ends on the outline
/// or on another street, no crossing except at ends, pieces within the
/// spacing parameters.
fn check(outline: &Shape, split: &OrganicSplit, params: &OrganicParams) {
    let streets = &split.streets;
    assert!(streets.len() >= 4, "only {} streets", streets.len());
    for (i, s) in streets.iter().enumerate() {
        assert!(
            s.path.len() >= 2 && s.widths.len() == s.path.len(),
            "street {i} malformed"
        );
        assert!(matches!(s.rank, 2 | 3), "street {i} rank {}", s.rank);
        assert!(
            matches!(s.role.as_str(), "street" | "lane" | "stairs"),
            "street {i} role {}",
            s.role
        );
        for &p in &s.path {
            assert!(
                contains(outline, p) || ring_distance(outline, p) < 0.2,
                "street {i} leaves the outline at {p:?}"
            );
        }
        for end in [s.path[0], *s.path.last().unwrap()] {
            let on_outline = ring_distance(outline, end) < 0.2;
            let on_street = streets
                .iter()
                .enumerate()
                .any(|(j, o)| j != i && path_distance(&o.path, end) < 0.2);
            assert!(
                on_outline || on_street,
                "street {i} ends in the open at {end:?}"
            );
        }
    }
    for (i, a) in streets.iter().enumerate() {
        for b in &streets[i + 1..] {
            for u in a.path.windows(2) {
                for v in b.path.windows(2) {
                    if let Some((_, hit)) = segment_hit(u[0], u[1], v[0], v[1]) {
                        assert!(
                            near_end(&a.path, hit, 0.5) || near_end(&b.path, hit, 0.5),
                            "streets cross at {hit:?}"
                        );
                    }
                }
            }
        }
    }
    let mut blocks = vec![];
    for piece in split.pieces.iter().filter(|p| p.level > 1) {
        let place = piece.kind == PieceKind::Place;
        let width = 2.0 * frame(&piece.shape).hv;
        let least = if place { 6.0 } else { params.min_width };
        assert!(
            width >= least - 1e-6,
            "piece {width:.1} m wide, below {least} m"
        );
        if !place {
            assert!(
                area(&piece.shape) >= params.min_block * 0.999,
                "block of {:.0} m2",
                area(&piece.shape)
            );
            blocks.push(area(&piece.shape));
        }
    }
    blocks.sort_by(f64::total_cmp);
    let median = blocks[blocks.len() / 2];
    assert!(
        median <= 2.0 * params.block_size[1],
        "median block {median:.0} m2"
    );
    let total: f64 = split.pieces.iter().map(|p| area(&p.shape)).sum();
    assert!(
        (total - area(outline)).abs() < area(outline) * 1e-3,
        "pieces cover {total:.0} of {:.0} m2",
        area(outline)
    );
}

#[test]
fn a_square_on_flat_ground_is_split_by_streets_that_meet() {
    let outline = square();
    let (split, params) = run(&outline, &Ramp { gx: 0.0, gy: 0.0 }, &armature());
    check(&outline, &split, &params);
}

#[test]
fn a_square_on_a_slope_is_split_by_streets_that_meet() {
    let outline = square();
    let (split, params) = run(&outline, &Ramp { gx: 0.06, gy: 0.02 }, &armature());
    check(&outline, &split, &params);
}

#[test]
fn an_irregular_outline_on_flat_ground_is_split_by_streets_that_meet() {
    let outline = irregular();
    let (split, params) = run(&outline, &Ramp { gx: 0.0, gy: 0.0 }, &armature());
    check(&outline, &split, &params);
}

#[test]
fn an_irregular_outline_on_a_slope_is_split_by_streets_that_meet() {
    let outline = irregular();
    let (split, params) = run(
        &outline,
        &Ramp {
            gx: -0.03,
            gy: 0.06,
        },
        &[],
    );
    check(&outline, &split, &params);
}

#[test]
fn the_same_inputs_lay_the_same_streets() {
    let outline = irregular();
    let terrain = Ramp { gx: 0.04, gy: 0.0 };
    let params = OrganicParams::default();
    let lay = || {
        lay_streets(
            &outline,
            &terrain,
            &armature(),
            &site(),
            &params,
            &mut Rng::new("organic-tissue-test").fork("quarter"),
        )
    };
    assert_eq!(lay(), lay());
}

/// On a steady 10 % slope rising east, streets run along the contour or
/// straight up it: most of their length lies within 20 degrees of the axes.
#[test]
fn streets_on_a_slope_follow_its_contours() {
    let outline = square();
    let (split, _) = run(&outline, &Ramp { gx: 0.10, gy: 0.0 }, &[]);
    let (mut aligned, mut total) = (0.0, 0.0);
    for s in &split.streets {
        for w in s.path.windows(2) {
            let length = w[0].distance(w[1]);
            let heading = (w[1].y - w[0].y)
                .atan2(w[1].x - w[0].x)
                .rem_euclid(FRAC_PI_2);
            if heading.min(FRAC_PI_2 - heading) < 20f64.to_radians() {
                aligned += length;
            }
            total += length;
        }
    }
    assert!(
        total > 0.0 && aligned / total > 0.55,
        "{:.0} % of street length on the contour axes",
        100.0 * aligned / total.max(1.0)
    );
}
