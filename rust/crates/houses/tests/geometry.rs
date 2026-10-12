use magna_urbis_houses::{
    catalogue::source_inventory,
    geometry::{area, area_tolerance, intersection, primitive, signed_area, unite},
};

#[test]
fn every_atlas_footprint_constructs_real_disjoint_geometry() {
    for entry in &source_inventory().unwrap().entries {
        if !entry.id.starts_with("FP-") {
            continue;
        }
        let shape = primitive(&entry.id, 20.0, 24.0, "houses:v1:42").unwrap();
        let replay = primitive(&entry.id, 20.0, 24.0, "houses:v1:42").unwrap();
        assert_eq!(shape.footprint, replay.footprint);
        let sum: f64 = shape.body_domains.iter().map(area).sum();
        let tolerance = area_tolerance(&shape.footprint).max(0.0001);
        assert!(
            (sum - area(&shape.footprint)).abs() < tolerance,
            "{} overlapping body domains",
            entry.id
        );
        assert!(
            area(&intersection(&shape.footprint, &shape.courts)) < tolerance,
            "{} court is filled",
            entry.id
        );
        assert_eq!(shape.footprint, unite(&shape.body_domains));
        for polygon in &shape.footprint {
            assert!(signed_area(&polygon.outer) > 0.0);
            assert_ne!(polygon.outer.first(), polygon.outer.last());
            for hole in &polygon.holes {
                assert!(signed_area(hole) < 0.0);
            }
            assert!(
                polygon
                    .outer
                    .iter()
                    .all(|p| p.x.is_finite() && p.y.is_finite())
            );
        }
    }
}

#[test]
fn courtyards_and_excavations_remain_distinct() {
    let court = primitive("FP-COURT", 20.0, 24.0, "42").unwrap();
    assert_eq!(court.footprint[0].holes.len(), 1);
    assert!((area(&court.footprint) + area(&court.courts) - 480.0).abs() < 0.001);
    let rock = primitive("FP-ROCKCUT", 20.0, 24.0, "42").unwrap();
    assert_eq!(area(&rock.excavation), 480.0);
    assert_eq!(rock.footprint, court.footprint);
    let terrace = primitive("FP-TERRACE", 20.0, 24.0, "42").unwrap();
    assert_eq!(terrace.tiers.len(), 3);
    for pair in terrace.tiers.windows(2) {
        assert!(area(&pair[1]) < area(&pair[0]));
    }
    assert!(primitive("FP-RECT", f64::NAN, 24.0, "42").is_err());
}
