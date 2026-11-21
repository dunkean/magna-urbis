use std::f64::consts::TAU;

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::geometry::{crest_above, dir, dot, pt};
use super::{
    Candidate, Regularity, TraceFamily, attach, bastioned_trace, parameter_trace, salient_points,
    shared_length, square_trace, trace,
};
use crate::spec::WallSpec;

const WIDTH: f64 = 2048.0;

struct Terrain {
    height: fn(Point) -> f64,
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
        !(0.0..WIDTH).contains(&p.x) || !(0.0..WIDTH).contains(&p.y)
    }

    fn water_code(&self, _: Point) -> u8 {
        0
    }

    fn dry_clip(&self, shape: &Shape) -> Vec<Shape> {
        g::intersection(shape, &g::rectangle(0.0, 0.0, WIDTH, WIDTH))
    }
}

const FLAT: Terrain = Terrain { height: |_| 0.0 };

/// A 30 m knoll just south of the line y = 700, centred at (1000, 690).
const KNOLL: Terrain = Terrain {
    height: |p| 30.0 * (-0.5 * ((p.x - 1000.0).powi(2) + (p.y - 690.0).powi(2)) / 400.0).exp(),
};

fn spec(style: &str, enclosure_shape: &str) -> WallSpec {
    WallSpec {
        stiffness: 0.0,
        terrain_adherence: 0.0,
        crest_limit: 12.0,
        style: style.into(),
        enclosure_shape: enclosure_shape.into(),
        keeps_citadel: false,
    }
}

fn regularity(stiffness: f64, crest_limit: f64) -> Regularity {
    Regularity {
        stiffness,
        adherence: 0.0,
        crest_limit,
        bank_walls: false,
        curtain_width: 3.0,
    }
}

fn inside_share(trace: &Shape, town: &Shape) -> f64 {
    g::intersection(trace, town)
        .iter()
        .map(g::area)
        .sum::<f64>()
        / g::area(town)
}

/// A town of radius 300 m whose edge wobbles by 8 m.
fn wobbly() -> Shape {
    let outer = (0..96)
        .map(|i| {
            let a = TAU * i as f64 / 96.0;
            let r = 300.0 + 8.0 * (7.0 * a).sin();
            pt(1024.0 + r * a.cos(), 1024.0 + r * a.sin())
        })
        .collect();
    Shape {
        outer,
        holes: vec![],
    }
}

#[test]
fn stiffness_zero_hugs_and_full_stiffness_straightens_within_the_land_share() {
    let town = wobbly();
    assert_eq!(
        parameter_trace(town.clone(), &FLAT, &regularity(0.0, 12.0)),
        town
    );
    let stiff = parameter_trace(town.clone(), &FLAT, &regularity(1.0, 12.0));
    assert!(g::simple(&stiff));
    assert!(
        stiff.outer.len() < 24,
        "{} vertices left",
        stiff.outer.len()
    );
    let share = inside_share(&stiff, &town);
    assert!(share >= 0.85 - 1e-9, "only {share:.3} of the land inside");
    let half = parameter_trace(town.clone(), &FLAT, &regularity(0.5, 12.0));
    assert!(half.outer.len() > stiff.outer.len() && inside_share(&half, &town) >= 0.92 - 1e-9);
}

#[test]
fn a_straight_run_keeps_the_founding_line_where_it_would_cross_a_crest() {
    // A square town with a 30 m notch in its south side, the knoll in front of it.
    let town = Shape {
        outer: vec![
            pt(700.0, 700.0),
            pt(950.0, 700.0),
            pt(950.0, 730.0),
            pt(1050.0, 730.0),
            pt(1050.0, 700.0),
            pt(1300.0, 700.0),
            pt(1300.0, 1300.0),
            pt(700.0, 1300.0),
        ],
        holes: vec![],
    };
    let crosses = |s: &Shape| {
        let ring: Vec<Point> = s
            .outer
            .iter()
            .copied()
            .chain(s.outer.first().copied())
            .collect();
        ring.windows(2)
            .any(|w| crest_above(&KNOLL, w[0], w[1], 12.0))
    };
    let free = parameter_trace(town.clone(), &KNOLL, &regularity(1.0, f64::INFINITY));
    assert!(
        crosses(&free),
        "without a limit the stiff trace runs straight over the knoll"
    );
    let held = parameter_trace(town.clone(), &KNOLL, &regularity(1.0, 12.0));
    assert!(
        !crosses(&held),
        "a run crosses the knoll above the limit: {:?}",
        held.outer
    );
    assert!(g::simple(&held) && inside_share(&held, &town) >= 0.85 - 1e-9);
}

#[test]
fn the_square_trace_is_a_rectangle_around_the_outline() {
    let town = Shape {
        outer: vec![
            pt(800.0, 900.0),
            pt(1050.0, 880.0),
            pt(1300.0, 900.0),
            pt(1320.0, 1050.0),
            pt(1300.0, 1200.0),
            pt(1050.0, 1215.0),
            pt(800.0, 1200.0),
            pt(785.0, 1050.0),
        ],
        holes: vec![],
    };
    let rect = square_trace(&town, &FLAT, true, false, None).expect("a square trace");
    assert_eq!(rect.outer.len(), 4, "{:?}", rect.outer);
    for i in 0..4 {
        let (a, v, b) = (
            rect.outer[(i + 3) % 4],
            rect.outer[i],
            rect.outer[(i + 1) % 4],
        );
        assert!(
            dot(dir(a, v), dir(v, b)).abs() < 1e-6,
            "corner {i} is not square"
        );
    }
    assert!(
        town.outer.iter().all(|&p| g::contains(&rect, p)),
        "the rectangle leaves part of the town out"
    );
    let traced = trace(&Candidate::new(town), &FLAT, &spec("curtain", "square"));
    assert_eq!(traced.family, TraceFamily::Square);
    assert_eq!((traced.outline.outer.len(), traced.corners.len()), (4, 4));
}

#[test]
fn a_bastioned_trace_has_a_salient_at_each_corner() {
    let town = g::rectangle(650.0, 750.0, 1350.0, 1250.0);
    let fronts = bastioned_trace(&town, &FLAT).expect("a bastioned trace");
    let salients = salient_points(&fronts.outer);
    for &corner in &town.outer {
        assert!(
            salients.iter().any(|s| s.distance(corner) < 25.0),
            "no salient at {corner:?}: {:?}",
            fronts.outer
        );
    }
    assert!(salients.iter().all(|s| fronts.outer.contains(s)));
    let mut candidate = Candidate::new(town);
    candidate.style = Some("bastioned");
    // Through the dispatcher the fronts are drawn over the curtain fit, whose rounded
    // corners may refuse the 98 % land bound: then the circuit is flanked, with a warning.
    let traced = trace(&candidate, &FLAT, &spec("curtain", "organic"));
    if traced.family == TraceFamily::Bastioned {
        assert_eq!(traced.style, "bastioned");
        assert_eq!(traced.salients, salient_points(&traced.outline.outer));
        assert!(traced.salients.len() >= 4, "{:?}", traced.outline.outer);
    } else {
        assert_eq!((traced.family, traced.style.as_str()), (TraceFamily::Polygonal, "flanked"));
        assert!(traced.salients.is_empty() && !traced.warnings.is_empty());
    }
}

#[test]
fn an_attached_lobe_shares_its_stretch_with_the_old_circuit() {
    let old = g::rectangle(100.0, 100.0, 500.0, 500.0);
    // The circuit around everything hugs the old one at a few metres and runs on east.
    let full = g::rectangle(96.0, 96.0, 900.0, 504.0);
    let lobe = attach(&old, &full).expect("a lobe");
    assert!(
        shared_length(&old, &lobe) > 300.0,
        "shared stretch {}",
        shared_length(&old, &lobe)
    );
    assert!(
        g::intersection(&old, &lobe)
            .iter()
            .map(g::area)
            .sum::<f64>()
            < 1.0,
        "the lobe overlaps the old town"
    );
    let union = g::union(&[old.clone(), lobe.clone()]);
    assert!(
        matches!(union.as_slice(), [one] if one.holes.is_empty() && g::simple(one)),
        "not one closed outline"
    );
    let mut candidate = Candidate::new(full);
    candidate.attach_to = Some(&old);
    let traced = trace(&candidate, &FLAT, &spec("curtain", "organic"));
    assert!(
        traced.warnings.is_empty() && !traced.shared.is_empty(),
        "{:?}",
        traced.warnings
    );
    let shared: f64 = traced.shared.iter().map(|(p, q)| p.distance(*q)).sum();
    assert!((shared - shared_length(&old, &traced.outline)).abs() < 1e-9 && shared > 300.0);
}
