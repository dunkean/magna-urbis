//! Reviewed28: exclude raw masks once, then split the same geo remainder.
use crate::geometry::{from_geo, signed_area, to_geo};
use crate::model::{Point, Polygon, Surface};
use geo::{BooleanOps, LineString, MultiPolygon, algorithm::bool_ops::FillRule};

fn canonical_ring(line: &LineString<f64>, positive: bool) -> Vec<Point> {
    let mut ring: Vec<_> = line.0.iter().map(|c| Point { x: c.x, y: c.y }).collect();
    if ring.len() > 1 && ring.first() == ring.last() {
        ring.pop();
    }
    ring.dedup();
    if (signed_area(&ring) > 0.0) != positive {
        ring.reverse();
    }
    if let Some(index) = (0..ring.len()).min_by(|&a, &b| {
        ring[a]
            .x
            .total_cmp(&ring[b].x)
            .then(ring[a].y.total_cmp(&ring[b].y))
    }) {
        ring.rotate_left(index);
    }
    ring
}

fn extract(geometry: &MultiPolygon<f64>) -> Surface {
    let mut surface: Surface = geometry
        .0
        .iter()
        .filter_map(|polygon| {
            let outer = canonical_ring(polygon.exterior(), true);
            if outer.len() < 3 || signed_area(&outer) == 0.0 {
                return None;
            }
            let mut holes: Vec<_> = polygon
                .interiors()
                .iter()
                .map(|line| canonical_ring(line, false))
                .filter(|ring| ring.len() >= 3 && signed_area(ring) != 0.0)
                .collect();
            holes.sort_by(|a, b| a[0].x.total_cmp(&b[0].x).then(a[0].y.total_cmp(&b[0].y)));
            Some(Polygon { outer, holes })
        })
        .collect();
    surface.sort_by(|a, b| {
        a.outer[0]
            .x
            .total_cmp(&b.outer[0].x)
            .then(a.outer[0].y.total_cmp(&b.outer[0].y))
    });
    surface
}

fn exclusion(occupied: &Surface, courts: &Surface, circulation: &Surface) -> MultiPolygon<f64> {
    let polygons = [occupied, courts, circulation]
        .into_iter()
        .flat_map(|mask| to_geo(mask).0)
        .collect();
    // Explicit rule: never infer it from a possibly minute first ring.
    MultiPolygon(polygons).union_with_fill_rule(&MultiPolygon(vec![]), FillRule::NonZero)
}

pub(super) fn occupied(domain: &Surface, occupied: &Surface) -> Surface {
    from_geo(&to_geo(domain).intersection_with_fill_rule(&to_geo(occupied), FillRule::NonZero))
}

pub(super) fn parts(
    footprint_domain: &Surface,
    occupied: &Surface,
    courts: &Surface,
    circulation: &Surface,
    floor: &Surface,
) -> (Surface, Surface) {
    let excluded = exclusion(occupied, courts, circulation);
    let remaining = to_geo(footprint_domain).difference(&excluded);
    let floor = to_geo(floor);
    (
        extract(&remaining.difference(&floor)),
        extract(&remaining.intersection(&floor)),
    )
}

#[cfg(test)]
mod tests {
    use super::super::{PartitionService, partition};
    use super::*;
    use crate::geometry::{area, intersection, rectangle, union};
    use geo::{Area, Validation};

    fn fixtures() -> Vec<serde_json::Value> {
        serde_json::from_str(include_str!(
            "../../../fixtures/houses/floor-complement-bits.json"
        ))
        .unwrap()
    }

    fn surface(value: &serde_json::Value, key: &str) -> Surface {
        let ring = |v: &serde_json::Value| {
            v.as_array()
                .unwrap()
                .iter()
                .map(|p| Point {
                    x: f64::from_bits(u64::from_str_radix(p[0].as_str().unwrap(), 16).unwrap()),
                    y: f64::from_bits(u64::from_str_radix(p[1].as_str().unwrap(), 16).unwrap()),
                })
                .collect()
        };
        value[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| Polygon {
                outer: ring(&p["outer"]),
                holes: p["holes"].as_array().unwrap().iter().map(ring).collect(),
            })
            .collect()
    }

    #[test]
    fn captured_masks_have_canonical_winding_and_disjoint_interiors() {
        for fixture in fixtures() {
            for key in ["domain_bits", "occupied_bits"] {
                let shape = to_geo(&surface(&fixture, key));
                shape.check_validation().unwrap();
                for polygon in &shape.0 {
                    assert!(
                        geo::Polygon::new(polygon.exterior().clone(), vec![]).signed_area() > 0.0
                    );
                    assert!(
                        polygon
                            .interiors()
                            .iter()
                            .all(|h| geo::Polygon::new(h.clone(), vec![]).signed_area() < 0.0)
                    );
                }
                for (i, a) in shape.0.iter().enumerate() {
                    for b in shape.0.iter().skip(i + 1) {
                        assert_eq!(
                            MultiPolygon(vec![a.clone()])
                                .intersection(&MultiPolygon(vec![b.clone()]))
                                .unsigned_area(),
                            0.0
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn captured_floor_partitions_pass_complete_conservation_validation() {
        for fixture in fixtures() {
            let domain = surface(&fixture, "domain_bits");
            let fu = surface(&fixture, "floor_domain_bits");
            let occupied = surface(&fixture, "occupied_bits");
            let courts = surface(&fixture, "courts_bits");
            let walk = surface(&fixture, "circulation_bits");
            let floor = surface(&fixture, "floor_bits");
            assert!(to_geo(&fu).difference(&to_geo(&domain)).unsigned_area() < 1e-6);
            assert!(
                to_geo(&domain)
                    .difference(&to_geo(&fu))
                    .difference(&to_geo(&walk))
                    .unsigned_area()
                    < 1e-6
            );
            let p = partition(
                &domain,
                occupied,
                courts,
                walk,
                PartitionService::FloorComplement {
                    floor,
                    footprint_domain: fu,
                },
            );
            let metrics = crate::validation::partition_metrics(&domain, &p).unwrap();
            assert!(metrics.bound_m2 < 2e-6);
            for part in [
                &p.occupied,
                &p.courtyards,
                &p.circulation,
                &p.service,
                &p.residual,
            ] {
                let micro = to_geo(part)
                    .0
                    .iter()
                    .filter(|p| p.unsigned_area() < 1e-4)
                    .count();
                assert!(micro <= 128, "{}: {micro} microfragments", fixture["id"]);
            }
            eprintln!("{}: {metrics:?}", fixture["id"]);
        }
    }

    // These two witnesses depend on the pinned i_overlay=4.5.2 debug assertion.
    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    #[should_panic(expected = "is_fill_top")]
    fn legacy_circulation_subtraction_panics_on_sib8_unit5_bits() {
        let fixture = &fixtures()[0];
        let domain = surface(fixture, "domain_bits");
        let occupied = surface(fixture, "occupied_bits");
        let remaining = crate::geometry::difference(&domain, &occupied);
        let remaining = crate::geometry::difference(&remaining, &surface(fixture, "courts_bits"));
        let _ = crate::geometry::difference(&remaining, &surface(fixture, "circulation_bits"));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    #[should_panic(expected = "is_fill_top")]
    fn legacy_occupied_intersection_panics_on_sib8_unit6_bits() {
        let fixture = &fixtures()[1];
        let _ = intersection(
            &surface(fixture, "domain_bits"),
            &surface(fixture, "occupied_bits"),
        );
    }

    #[test]
    fn extraction_keeps_positive_polygons_and_holes_below_old_cutoff() {
        let side = 2.0_f64.powi(-20);
        let small = |x: f64, y: f64| {
            vec![
                Point { x, y },
                Point { x: x + side, y },
                Point {
                    x: x + side,
                    y: y + side,
                },
                Point { x, y: y + side },
            ]
        };
        let mut hole = small(0.5, 0.5);
        hole.reverse();
        let mut raw = rectangle(0.0, 0.0, 1.0, 1.0);
        raw[0].holes.push(hole);
        raw.push(Polygon {
            outer: small(2.0, 0.0),
            holes: vec![],
        });
        let extracted = extract(&to_geo(&raw));
        assert_eq!(extracted.len(), 2);
        assert_eq!(extracted[0].holes.len(), 1);
        assert!(area(&vec![extracted[1].clone()]) > 0.0);
        assert!(area(&vec![extracted[1].clone()]) < 1e-10);
        assert_eq!(to_geo(&extracted).xor(&to_geo(&raw)).unsigned_area(), 0.0);
    }

    #[test]
    fn explicit_union_rule_does_not_depend_on_a_minute_first_fragment() {
        let side = 2.0_f64.powi(-18);
        let tiny = vec![Polygon {
            outer: vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: side, y: 0.0 },
                Point { x: 0.0, y: side },
            ],
            holes: vec![],
        }];
        let large = rectangle(2.0, 0.0, 2.0, 2.0);
        let joined = exclusion(&[tiny.clone(), large.clone()].concat(), &vec![], &vec![]);
        let reference = to_geo(&large);
        let error = joined.xor(&reference).unsigned_area();
        assert!(
            error <= area(&tiny),
            "difference {error}, fragment {}",
            area(&tiny)
        );
        assert!((joined.unsigned_area() - 4.0).abs() <= area(&tiny));
    }

    #[test]
    fn caller_domain_extension_is_entirely_excluded_by_walk() {
        let fu = rectangle(0.0, 0.0, 4.0, 4.0);
        let lot = rectangle(-1.0, -1.0, 9.0, 9.0);
        let walk = rectangle(3.0, 1.0, 4.0, 1.0);
        let domain = union(&fu, &intersection(&walk, &lot));
        let p = partition(
            &domain,
            rectangle(0.0, 0.0, 1.0, 4.0),
            vec![],
            walk,
            PartitionService::FloorComplement {
                floor: fu.clone(),
                footprint_domain: fu,
            },
        );
        let metrics = crate::validation::partition_metrics(&domain, &p).unwrap();
        assert_eq!(metrics.bound_m2, 0.0);
        assert_eq!(area(&p.service), 0.0);
        assert_eq!(area(&p.residual), 11.0);
    }

    #[test]
    fn complete_sib8_batch_preserves_programme_and_validates_every_unit() {
        let config = serde_json::from_str(include_str!(
            "../../../fixtures/houses/config-sib8-floor-complement.json"
        ))
        .unwrap();
        let batch = crate::generate_batch(config).unwrap();
        assert_eq!(batch.units.len(), 10);
        let counts: Vec<_> = batch
            .units
            .iter()
            .map(|u| (u.bodies.len(), u.rooms.len()))
            .collect();
        assert_eq!(
            counts,
            [
                (3, 3),
                (3, 3),
                (6, 18),
                (6, 18),
                (3, 9),
                (4, 12),
                (4, 12),
                (5, 10),
                (6, 18),
                (5, 15)
            ]
        );
        for unit in &batch.units {
            crate::validation::validate_unit(unit).unwrap();
        }
    }
}
