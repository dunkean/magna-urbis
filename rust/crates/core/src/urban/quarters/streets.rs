//! Street lengths and width interpolation for newly drawn streets.

use crate::rng::Rng;
use crate::urban::{Morph, Point, Street};

pub(super) fn len(path: &[Point]) -> f64 {
    path.windows(2)
        .map(|q| (q[0].x - q[1].x).hypot(q[0].y - q[1].y))
        .sum()
}

pub(super) fn add(
    streets: &mut Vec<Street>,
    path: Vec<Point>,
    rank: usize,
    role: &str,
    m: &Morph,
    rng: &mut Rng,
) {
    if path.len() < 2 || len(&path) < 0.2 {
        return;
    }
    // Width changes are gradual along the street, not a new jitter every 5 m.
    let wa = m.width(rank, rng);
    let wb = m.width(rank, rng);
    let length = len(&path);
    let mut at = 0.0;
    let widths = path
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if i > 0 {
                at += (p.x - path[i - 1].x).hypot(p.y - path[i - 1].y);
            }
            wa + (wb - wa) * at / length
        })
        .collect();
    streets.push(Street {
        path,
        widths,
        rank,
        role: role.into(),
    })
}
