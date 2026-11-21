//! Tests for trimming peripheral frontage around walls.

use super::{MIN_FRONTAGE_PIECE, off_reserve};
use crate::urban::{Enclosure, Point, Street, geometry as g};

/// Peripheral frontage gives up the fortification reserve before it
/// becomes a quarter; what is left of it still faces its road.
#[test]
fn peripheral_frontage_never_enters_the_wall_reserve() {
    let road = Street {
        path: vec![Point { x: 0.0, y: 50.0 }, Point { x: 100.0, y: 50.0 }],
        widths: vec![6.0, 6.0],
        rank: 2,
        role: "peripheral".into(),
    };
    // The band along the road; the reserve takes its west end and a
    // strip across it (60 < y < 64), cutting off a part with no road.
    let band = g::rectangle(0.0, 25.0, 100.0, 75.0);
    let enclosure = Enclosure {
        reserve: vec![
            g::rectangle(-10.0, 0.0, 30.0, 100.0),
            g::rectangle(30.0, 60.0, 110.0, 64.0),
        ],
        ..Default::default()
    };
    let kept = off_reserve(vec![(band, 3)], std::slice::from_ref(&enclosure), &[road]);
    assert!(!kept.is_empty());
    for (shape, source) in &kept {
        assert_eq!(*source, 3);
        assert!(g::area(shape) >= MIN_FRONTAGE_PIECE);
        for r in &enclosure.reserve {
            let inside: f64 = g::intersection(shape, r).iter().map(g::area).sum();
            assert!(inside < 0.01, "{inside:.2} m² in the reserve");
        }
    }
    let area: f64 = kept.iter().map(|(s, _)| g::area(s)).sum();
    assert!((area - 70.0 * 35.0).abs() < 1.0, "{area:.1}");
    // No reserve: the frontage is returned untouched.
    let free = off_reserve(vec![(g::rectangle(0.0, 25.0, 100.0, 75.0), 1)], &[], &[]);
    assert_eq!(free.len(), 1);
}
