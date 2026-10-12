//! Conservation without reuniting masks derived from the same domain.
use super::surface_valid;
use crate::geometry::{area, area_tolerance, bounds, difference, intersection, to_geo};
use crate::model::{Partition, Polygon, Surface};
use geo::Validation;

#[derive(Clone, Debug)]
pub struct PartitionMetrics {
    pub domain_area_m2: f64,
    pub parts_area_m2: f64,
    pub outside_area_m2: f64,
    pub pair_overlap_area_m2: f64,
    pub bound_m2: f64,
    pub tolerance_m2: f64,
    pub pairs_evaluated: usize,
}

struct Piece {
    name: &'static str,
    index: usize,
    surface: Surface,
    bounds: [f64; 4],
}

fn polygon_valid(name: &str, index: usize, polygon: &Polygon) -> Result<Surface, String> {
    let one = vec![polygon.clone()];
    surface_valid(&one).map_err(|error| format!("Partition {name}[{index}] : {error}"))?;
    to_geo(&one).0[0]
        .check_validation()
        .map_err(|error| format!("Partition {name}[{index}] : polygone invalide ({error})."))?;
    let measured = area(&one);
    if !measured.is_finite() || measured <= 0.0 {
        return Err(format!(
            "Partition {name}[{index}] : aire non finie ou non positive ({measured} m²)."
        ));
    }
    Ok(one)
}

fn accumulate(total: &mut f64, term: f64, context: &str) -> Result<(), String> {
    if !term.is_finite() || term < 0.0 {
        return Err(format!(
            "Partition {context} : mesure invalide ({term} m²)."
        ));
    }
    *total += term;
    if !total.is_finite() {
        return Err(format!("Partition {context} : cumul d'aire non fini."));
    }
    Ok(())
}

fn budget(metrics: &mut PartitionMetrics, context: &str) -> Result<(), String> {
    metrics.bound_m2 = (metrics.domain_area_m2 - metrics.parts_area_m2).abs()
        + 2.0 * metrics.outside_area_m2
        + metrics.pair_overlap_area_m2;
    if !metrics.bound_m2.is_finite() || metrics.bound_m2 > metrics.tolerance_m2 {
        return Err(format!(
            "Partition {context} : conservation hors budget ; D={:.9}, S={:.9}, O={:.9}, Q={:.9}, B={:.9}, T={:.9} m².",
            metrics.domain_area_m2,
            metrics.parts_area_m2,
            metrics.outside_area_m2,
            metrics.pair_overlap_area_m2,
            metrics.bound_m2,
            metrics.tolerance_m2,
        ));
    }
    Ok(())
}

pub(super) fn validate(domain: &Surface, p: &Partition) -> Result<PartitionMetrics, String> {
    let mut metrics = PartitionMetrics {
        domain_area_m2: 0.0,
        parts_area_m2: 0.0,
        outside_area_m2: 0.0,
        pair_overlap_area_m2: 0.0,
        bound_m2: 0.0,
        tolerance_m2: 0.0,
        pairs_evaluated: 0,
    };
    for (index, polygon) in domain.iter().enumerate() {
        let one = polygon_valid("domaine", index, polygon)?;
        accumulate(&mut metrics.domain_area_m2, area(&one), "domaine")?;
    }
    metrics.tolerance_m2 = area_tolerance(domain).max(0.005);
    if !metrics.tolerance_m2.is_finite() {
        return Err("Partition domaine : budget d'aire non fini.".into());
    }
    let surfaces = [
        ("occupied", &p.occupied),
        ("courtyards", &p.courtyards),
        ("circulation", &p.circulation),
        ("service", &p.service),
        ("residual", &p.residual),
    ];
    let mut pieces = vec![];
    for (name, surface) in surfaces {
        for (index, polygon) in surface.iter().enumerate() {
            let one = polygon_valid(name, index, polygon)?;
            accumulate(&mut metrics.parts_area_m2, area(&one), name)?;
            pieces.push(Piece {
                name,
                index,
                bounds: bounds(&one),
                surface: one,
            });
        }
    }
    // H + X <= |D-S| + 2O + Q: multiplicity excess is bounded by
    // pair intersections, including pairs belonging to the same named part.
    // This also bounds overlap by Q; it does not claim H + X + overlap <= B.
    budget(&mut metrics, "bilan d'aire")?;
    for piece in &pieces {
        let context = format!("débordement {}[{}]", piece.name, piece.index);
        accumulate(
            &mut metrics.outside_area_m2,
            area(&difference(&piece.surface, domain)),
            &context,
        )?;
        budget(&mut metrics, &context)?;
    }
    for (i, a) in pieces.iter().enumerate() {
        for b in pieces.iter().skip(i + 1) {
            if a.bounds[2] <= b.bounds[0]
                || b.bounds[2] <= a.bounds[0]
                || a.bounds[3] <= b.bounds[1]
                || b.bounds[3] <= a.bounds[1]
            {
                continue;
            }
            metrics.pairs_evaluated += 1;
            let context = format!(
                "recouvrement {}[{}] / {}[{}]",
                a.name, a.index, b.name, b.index
            );
            accumulate(
                &mut metrics.pair_overlap_area_m2,
                area(&intersection(&a.surface, &b.surface)),
                &context,
            )?;
            budget(&mut metrics, &context)?;
        }
    }
    Ok(metrics)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{point, rectangle};

    fn empty() -> Partition {
        Partition {
            occupied: vec![],
            courtyards: vec![],
            circulation: vec![],
            service: vec![],
            residual: vec![],
        }
    }

    #[test]
    fn native_oc_pac_partition_validates_without_reunion_or_mutation() {
        #[derive(serde::Deserialize)]
        struct Fixture {
            domain: Surface,
            partition: Partition,
        }
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../../fixtures/houses/partition-oc-pac-b01-level0.json"
        ))
        .unwrap();
        let before = serde_json::to_string(&fixture.partition).unwrap();
        let first = validate(&fixture.domain, &fixture.partition).unwrap();
        let replay = validate(&fixture.domain, &fixture.partition).unwrap();
        assert_eq!(first.bound_m2, replay.bound_m2);
        assert_eq!(first.pairs_evaluated, replay.pairs_evaluated);
        assert_eq!(before, serde_json::to_string(&fixture.partition).unwrap());
        assert!(first.bound_m2 <= first.tolerance_m2);
    }

    #[test]
    fn exact_partition_with_holes_and_disconnected_domain_passes() {
        let mut domain = rectangle(0.0, 0.0, 8.0, 8.0);
        domain[0].holes = vec![vec![
            point(2.0, 2.0),
            point(2.0, 6.0),
            point(6.0, 6.0),
            point(6.0, 2.0),
        ]];
        domain.extend(rectangle(10.0, 0.0, 2.0, 2.0));
        let mut partition = empty();
        partition.occupied.push(domain[0].clone());
        partition.residual.push(domain[1].clone());
        let metrics = validate(&domain, &partition).unwrap();
        assert_eq!(metrics.bound_m2, 0.0);
    }

    #[test]
    fn hole_compensated_by_equal_overlap_is_rejected_between_parts() {
        let domain = rectangle(0.0, 0.0, 10.0, 10.0);
        let mut partition = empty();
        partition.occupied = rectangle(0.0, 0.0, 5.0, 10.0);
        partition.courtyards = rectangle(4.0, 0.0, 5.0, 10.0);
        assert_eq!(
            area(&partition.occupied) + area(&partition.courtyards),
            area(&domain)
        );
        assert!(
            validate(&domain, &partition)
                .unwrap_err()
                .contains("recouvrement")
        );
    }

    #[test]
    fn overlap_inside_one_part_cannot_compensate_a_hole() {
        let domain = rectangle(0.0, 0.0, 10.0, 10.0);
        let mut partition = empty();
        partition.occupied = rectangle(0.0, 0.0, 5.0, 10.0);
        partition.occupied.extend(rectangle(4.0, 0.0, 5.0, 10.0));
        assert_eq!(area(&partition.occupied), area(&domain));
        assert!(
            validate(&domain, &partition)
                .unwrap_err()
                .contains("occupied[0] / occupied[1]")
        );
    }

    #[test]
    fn many_small_leaks_and_overlaps_use_a_cumulative_budget() {
        let domain = rectangle(0.0, 0.0, 10.0, 10.0);
        let tolerance = area_tolerance(&domain).max(0.005);
        let mut leaks = empty();
        for i in 0..5 {
            let one = rectangle(i as f64 * 2.0, -0.003, 2.0, 10.0);
            assert!(area(&difference(&one, &domain)) < tolerance);
            leaks.occupied.extend(one);
        }
        assert!((area(&leaks.occupied) - area(&domain)).abs() < 1e-9);
        assert!(
            validate(&domain, &leaks)
                .unwrap_err()
                .contains("débordement")
        );
        let mut overlaps = empty();
        for x in [0.0, 2.499, 4.998, 7.497] {
            overlaps.occupied.extend(rectangle(x, 0.0, 2.5, 10.0));
        }
        for pair in overlaps.occupied.windows(2) {
            assert!(
                area(&intersection(
                    &vec![pair[0].clone()],
                    &vec![pair[1].clone()]
                )) < tolerance
            );
        }
        assert!((area(&overlaps.occupied) - area(&domain)).abs() < 1e-9);
        assert!(
            validate(&domain, &overlaps)
                .unwrap_err()
                .contains("recouvrement")
        );
    }

    #[test]
    fn double_wound_ring_and_duplicate_domain_are_rejected() {
        let domain = rectangle(0.0, 0.0, 10.0, 10.0);
        let mut partition = empty();
        partition.occupied = rectangle(0.0, 0.0, 5.0, 10.0);
        let ring = partition.occupied[0].outer.clone();
        partition.occupied[0].outer.extend(ring);
        assert_eq!(area(&partition.occupied), area(&domain));
        assert!(
            validate(&domain, &partition)
                .unwrap_err()
                .contains("polygone invalide")
        );
        partition.occupied = domain.clone();
        let mut duplicate_domain = domain.clone();
        duplicate_domain.extend(domain.clone());
        assert!(
            validate(&duplicate_domain, &partition)
                .unwrap_err()
                .contains("bilan d'aire")
        );
    }

    #[test]
    fn non_finite_coordinates_are_rejected_before_boolean_operations() {
        let mut domain = rectangle(0.0, 0.0, 10.0, 10.0);
        domain[0].outer[0].x = f64::NAN;
        assert!(validate(&domain, &empty()).is_err());
    }

    #[test]
    fn complete_oc_pac_seed42_batch_is_replayable() {
        let config: crate::model::HouseConfig = serde_json::from_str(include_str!(
            "../../../fixtures/houses/config-oc-pac-partition.json"
        ))
        .unwrap();
        let first = crate::generate_batch(config.clone()).unwrap();
        let replay = crate::generate_batch(config).unwrap();
        assert_eq!(first.units.len(), 10);
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&replay).unwrap()
        );
    }
}
