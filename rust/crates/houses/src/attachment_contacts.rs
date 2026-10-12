//! Reviewed30: metric contact between a feature cover and a walkable slab.
use super::EPS;
use crate::geometry::{area, offset};
use crate::model::Surface;

const CONTACT_M: f64 = 1e-6;

fn perimeter(surface: &Surface) -> f64 {
    surface
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
        .map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(a, b)| libm::hypot(b.x - a.x, b.y - a.y))
                .sum::<f64>()
        })
        .sum()
}

fn metric_conflict(area: f64, perimeter: f64, eroded_area: f64) -> bool {
    area > EPS && (eroded_area > EPS || area > CONTACT_M * perimeter + EPS)
}

pub(super) fn conflicts(overlap: &Surface) -> bool {
    let overlap_area = area(overlap);
    if overlap_area <= EPS {
        return false;
    }
    // A long numerical boundary contact can have large cumulative area.
    // Require the existing metric interior, while conservatively refusing a
    // substantial intersection if its offset unexpectedly reports no area.
    metric_conflict(
        overlap_area,
        perimeter(overlap),
        area(&offset(overlap, -CONTACT_M)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Point, Polygon};

    fn rectangle(x: f64, y: f64, width: f64, depth: f64) -> Surface {
        vec![Polygon {
            outer: vec![
                Point { x, y },
                Point { x: x + width, y },
                Point {
                    x: x + width,
                    y: y + depth,
                },
                Point { x, y: y + depth },
            ],
            holes: vec![],
        }]
    }

    #[test]
    fn exact_native_contacts_have_no_metric_interior() {
        let fixtures: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "../../../fixtures/houses/gallery-slab-contacts.json"
        ))
        .unwrap();
        for fixture in fixtures {
            let overlap: Surface = serde_json::from_value(fixture["overlap"].clone()).unwrap();
            assert!(area(&overlap) > 1e-6);
            assert_eq!(area(&offset(&overlap, -CONTACT_M)), 0.0);
            assert!(!conflicts(&overlap), "{}", fixture["id"]);
        }
    }

    #[test]
    fn length_and_disconnected_contacts_do_not_create_interior() {
        let width = 2_f64.powi(-24);
        let mut overlap = rectangle(0.0, 0.0, 10.224, width);
        assert!(!conflicts(&overlap));
        overlap.extend(rectangle(15.759, 0.0, 10.224, width));
        assert!(area(&overlap) > 1e-6);
        assert!(!conflicts(&overlap));
        assert!(!conflicts(&rectangle(0.0, 0.0, width, 28.942)));
    }

    #[test]
    fn real_penetrations_and_small_wide_squares_are_conflicts() {
        for overlap in [
            rectangle(0.0, 0.0, 1.0, 2.1e-6),
            rectangle(0.0, 0.0, 1.0, 0.001),
            rectangle(0.0, 0.0, 0.0012, 0.0012),
            rectangle(0.0, 0.0, 0.0009, 0.0009),
        ] {
            assert!(conflicts(&overlap));
        }
    }

    #[test]
    fn an_empty_offset_cannot_hide_a_substantial_intersection() {
        assert!(metric_conflict(1.0, 4.0, 0.0));
        assert!(metric_conflict(8.1e-7, 0.0036, 0.0));
        assert!(!metric_conflict(1.7e-6, 58.0, 0.0));
    }
}
