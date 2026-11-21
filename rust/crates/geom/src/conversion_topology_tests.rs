use super::*;
use crate::{area, rectangle, test_support::measure_conversions};
use geo::Validation;
use serde_json::Value;

fn encoded(v: &[Shape]) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn multi(s: &Shape) -> geo::MultiPolygon<f64> {
    geo::MultiPolygon(vec![polygon(s)])
}
fn metadata() -> Value {
    serde_json::from_str(include_str!(
        "../tests/fixtures/byzantine-conversion-witness-bits.json"
    ))
    .unwrap()
}
fn original_raw() -> Shape {
    let m = metadata();
    let ring = |v: &Value| {
        v.as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let f = |i: usize| {
                    f64::from_bits(u64::from_str_radix(p[i].as_str().unwrap(), 16).unwrap())
                };
                Point { x: f(0), y: f(1) }
            })
            .collect()
    };
    Shape {
        outer: ring(&m["rawOuterBits"]),
        holes: m["rawHoleBits"]
            .as_array()
            .unwrap()
            .iter()
            .map(ring)
            .collect(),
    }
}
fn legacy_shapes(p: geo::MultiPolygon<f64>) -> Vec<Shape> {
    fn ring(l: &LineString<f64>) -> Vec<Point> {
        let mut r: Vec<_> = l.0.iter().map(|p| Point { x: p.x, y: p.y }).collect();
        if r.len() > 1
            && (r[0].x - r[r.len() - 1].x).abs() + (r[0].y - r[r.len() - 1].y).abs() < 1e-8
        {
            r.pop();
        }
        r.dedup_by(|a, b| (a.x - b.x).hypot(a.y - b.y) < 1e-7);
        r
    }
    p.0.into_iter()
        .filter(|p| p.unsigned_area() > 0.01)
        .map(|p| {
            normalized(Shape {
                outer: ring(p.exterior()),
                holes: p.interiors().iter().map(ring).collect(),
            })
        })
        .filter(|p| p.outer.len() >= 3)
        .collect()
}

#[test]
fn exact_root_boolean_raw_ring_is_retained_when_approximate_dedup_crosses() {
    let raw = original_raw();
    assert_eq!(raw.outer.len(), 12);
    assert!(polygon(&raw).is_valid());
    let old = legacy_shapes(multi(&raw));
    assert_eq!(old.len(), 1);
    assert_eq!(old[0].outer.len(), 11);
    assert!(!polygon(&old[0]).is_valid());
    let (got, c) = measure_conversions(|| shapes(multi(&raw)));
    assert_eq!(c, [1, 1, 1, 1]);
    assert!(polygon(&got[0]).is_valid());
    assert_eq!(
        encoded(&got),
        encoded(&[normalized(raw)]),
        "Only preserve the actual raw boundary, no repair or coordinate displacement"
    );
}
#[test]
fn valid_historical_near_vertex_simplification_is_byte_exact() {
    let raw = Shape {
        outer: vec![
            Point { x: 0., y: 0. },
            Point { x: 1e-8, y: 0. },
            Point { x: 10., y: 0. },
            Point { x: 10., y: 10. },
            Point { x: 0., y: 10. },
        ],
        holes: vec![],
    };
    let old = legacy_shapes(multi(&raw));
    assert!(polygon(&old[0]).is_valid());
    let (got, c) = measure_conversions(|| shapes(multi(&raw)));
    assert_eq!(encoded(&got), encoded(&old));
    assert_eq!(c, [1, 1, 0, 0]);
}
#[test]
fn exact_duplicate_removal_never_runs_validators() {
    let raw = Shape {
        outer: vec![
            Point { x: 0., y: 0. },
            Point { x: 0., y: 0. },
            Point { x: 10., y: 0. },
            Point { x: 10., y: 10. },
            Point { x: 0., y: 10. },
        ],
        holes: vec![],
    };
    let (got, c) = measure_conversions(|| shapes(multi(&raw)));
    assert_eq!(encoded(&got), encoded(&legacy_shapes(multi(&raw))));
    assert_eq!(c, [1, 0, 0, 0]);
}
#[test]
fn ordinary_outer_and_hole_keep_the_no_validation_fast_path() {
    let mut raw = rectangle(0., 0., 100., 100.);
    raw.holes.push(rectangle(20., 20., 30., 30.).outer);
    let (got, c) = measure_conversions(|| shapes(multi(&raw)));
    assert_eq!(encoded(&got), encoded(&legacy_shapes(multi(&raw))));
    assert_eq!(c, [1, 0, 0, 0]);
    assert_eq!(got[0].holes.len(), 1);
}
#[test]
fn minimum_valid_triangle_cannot_disappear_when_near_vertices_are_distinct() {
    let raw = Shape {
        outer: vec![
            Point { x: 0., y: 0. },
            Point { x: 1e-8, y: 0. },
            Point { x: 1e7, y: 1e7 },
        ],
        holes: vec![],
    };
    assert!(area(&raw) > 0.01);
    assert!(polygon(&raw).is_valid());
    assert!(legacy_shapes(multi(&raw)).is_empty());
    let (got, c) = measure_conversions(|| shapes(multi(&raw)));
    assert_eq!(c, [1, 1, 1, 1]);
    assert_eq!(encoded(&got), encoded(&[raw]));
}
#[test]
fn a_risky_hole_keeps_its_raw_boundary_and_the_same_outer() {
    let raw = Shape {
        outer: rectangle(2090., 2020., 2120., 2050.).outer,
        holes: vec![original_raw().outer],
    };
    assert!(polygon(&raw).is_valid());
    assert!(!polygon(&legacy_shapes(multi(&raw))[0]).is_valid());
    let (got, c) = measure_conversions(|| shapes(multi(&raw)));
    assert_eq!(c, [1, 1, 1, 1]);
    assert_eq!(encoded(&got), encoded(&[normalized(raw)]));
    assert!(polygon(&got[0]).is_valid());
}
#[test]
fn invalid_raw_input_is_never_repaired_or_certified_by_this_guard() {
    let raw = Shape {
        outer: vec![
            Point { x: 0., y: 0. },
            Point { x: 6., y: 4. },
            Point { x: 0., y: 4. },
            Point { x: 4., y: 0. },
            Point {
                x: 4. - 1e-8,
                y: 0.,
            },
            Point { x: -2., y: -1. },
        ],
        holes: vec![],
    };
    assert!(!polygon(&raw).is_valid());
    assert!(area(&raw) > 0.01);
    let old = legacy_shapes(multi(&raw));
    assert_eq!(old.len(), 1);
    assert!(!polygon(&old[0]).is_valid());
    let (got, c) = measure_conversions(|| shapes(multi(&raw)));
    assert_eq!(encoded(&got), encoded(&old));
    assert_eq!(c, [1, 1, 1, 0]);
}
