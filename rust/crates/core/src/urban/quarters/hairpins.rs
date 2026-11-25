//! Wide hairpin bends of the final town network, whatever laid the street: an imported regional road, a routed
//! street or a lane. Run before the blocks are cut, so they follow the bends.

use super::stairs::{Line, Segments, Walls};
use crate::hairpins;
use crate::urban::{Enclosure, Point, Street, Surface, geometry as g, routing};

/// Round the pointed tips that have room: dry ground that can be levelled, across no curtain, no nearer to another
/// street than the street already was.
pub(super) fn settle(streets: &mut [Street], enclosures: &[Enclosure], surface: Surface<'_>) {
    let segments = Segments::new(streets);
    let walls = Walls::new(enclosures);
    for i in 0..streets.len() {
        let s = &streets[i];
        let works = matches!(
            s.role.as_str(),
            "bridge" | "ford" | "causeway" | "quay" | "pier" | "mole" | "landing" | "boardwalk" | "walkway" | "stairs" | "port-stairs" | "wall-lane" | "boundary"
        );
        if works || s.path.len() < 3 {
            continue;
        }
        let width = s.widths.iter().copied().fold(2.0, f64::max);
        let line = Line::new(&s.path);
        let fits = |old: &[Point], new: &[Point]| clear(i, 0.5 * width, old, new, &segments, &walls, surface);
        // The joints are read only for a street that has a tip.
        if hairpins::round(&s.path, width, &[], |_, _| true).is_none() {
            continue;
        }
        let joints: Vec<f64> = segments.joints(i, &line).into_iter().map(|j| j.0).collect();
        if let Some(path) = hairpins::round(&s.path, width, &joints, fits) {
            let widths = path.iter().map(|&p| line.width(&s.widths, line.project(p))).collect();
            let street = Street { path, widths, rank: s.rank, role: s.role.clone() };
            streets[i] = street;
        }
    }
}

/// Whether the bend `new` may replace the stretch `old` of street `own`.
fn clear(own: usize, half: f64, old: &[Point], new: &[Point], segments: &Segments, walls: &Walls, surface: Surface<'_>) -> bool {
    if !routing::path_clear(surface, new, hairpins::PLATFORM) {
        return false;
    }
    let gap = |path: &[Point], a: Point, b: Point| {
        path.windows(2).map(|w| [g::distance(w[0], a, b).0, g::distance(w[1], a, b).0, g::distance(a, w[0], w[1]).0, g::distance(b, w[0], w[1]).0].into_iter().fold(f64::INFINITY, f64::min)).fold(f64::INFINITY, f64::min)
    };
    let hit = |path: &[Point], a: Point, b: Point| path.windows(2).any(|w| g::segment_hit(w[0], w[1], a, b).is_some());
    new.windows(2).all(|w| {
        !walls.crossed(w[0], w[1])
            && segments.near(own, w[0], w[1], half + 8.0).into_iter().all(|s| {
                let before = gap(old, s.a, s.b);
                // A street that met the old stretch met it at the tip, which the bend keeps.
                before < 0.3 || !hit(new, s.a, s.b) && (gap(w, s.a, s.b) >= half + s.half + 1.0 || gap(new, s.a, s.b) >= before - 0.01)
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_town_hairpin_takes_a_wide_bend_unless_a_street_stands_there() {
        let (height, water) = ((0..128 * 128).map(|i| (i / 128) as f32 * 0.6).collect::<Vec<f32>>(), vec![0u8; 128 * 128]);
        let surface = Surface { geometry: None, width: 256.0, n: 128, height: &height, water: &water, interpolation: Default::default() };
        let way = |points: &[(f64, f64)], role: &str| Street {
            path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            widths: vec![6.0; points.len()],
            rank: 1,
            role: role.into(),
        };
        let road = way(&[(40.0, 100.0), (150.0, 116.0), (40.0, 132.0)], "regional");
        let settled = |extra: Vec<Street>| {
            let mut streets = [vec![road.clone()], extra].concat();
            settle(&mut streets, &[], surface);
            streets[0].path.clone()
        };
        let bent = settled(vec![]);
        assert!(bent.len() > 10 && bent.contains(&road.path[1]), "{bent:?}");
        // A lane that ends on the tip stays joined to it.
        assert!(settled(vec![way(&[(150.0, 116.0), (220.0, 116.0)], "lane")]).contains(&road.path[1]));
        // A street along the legs leaves no room for the swing.
        let blocked = settled(vec![way(&[(100.0, 101.0), (160.0, 109.5)], "lane"), way(&[(100.0, 131.0), (160.0, 122.5)], "lane")]);
        assert_eq!(blocked, road.path);
    }
}
