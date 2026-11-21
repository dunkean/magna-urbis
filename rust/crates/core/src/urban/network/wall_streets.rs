//! Street widths through gate passages and wall lanes seeded along enclosures.

use super::curtains::lane_line;
use super::spatial::{EPS, distance, lerp};
use super::street::width;
use crate::urban::{Enclosure, LayoutConfig, Point, Street, Surface};

/// Invariant (gate passages): a street through a land gatehouse is at most
/// `passage_width_m - 1` wide inside the passage, so half a metre of clear
/// passage stays on each side and the gatehouse masses never yield to it.
/// The segment crossing the curtain gets vertices at the passage ends and
/// at the crossing, at the capped width; outside them it keeps its width.
pub(in crate::urban) fn cap_gate_passages(streets: &mut [Street], enclosures: &[Enclosure]) {
    use crate::urban::geometry as g;
    for e in enclosures.iter().filter(|e| e.path.len() >= 4) {
        let near = crate::urban::fortification::Near::new(&e.path, 20.0);
        // Street boxes (a vertex inserted in a passage lies on its segment,
        // so they hold): a crossing within 12 m of a passage middle needs a
        // street whose box comes that close.
        let boxes: Vec<(f64, f64, f64, f64)> = streets
            .iter()
            .map(|s| s.path.iter().fold((f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
                |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y))))
            .collect();
        for gh in e.gatehouses.iter().filter(|gh| !matches!(gh.kind.as_str(), "water" | "shore")) {
            let cap = gh.passage_width_m - 1.0;
            if cap <= 0.5 {
                continue;
            }
            let mid = lerp(gh.passage[0], gh.passage[1], 0.5);
            let half_len = distance(gh.passage[0], gh.passage[1]) * 0.5 + 1.0;
            for (s, b) in streets.iter_mut().zip(&boxes).filter(|(s, _)| s.role != "wall-lane") {
                if s.widths.len() != s.path.len() {
                    let last = s.widths.last().copied().unwrap_or(4.0);
                    s.widths.resize(s.path.len(), last);
                }
                if mid.x < b.0 - 13.0 || mid.x > b.2 + 13.0 || mid.y < b.1 - 13.0 || mid.y > b.3 + 13.0 {
                    continue;
                }
                let mut i = 0;
                while i + 1 < s.path.len() {
                    let (a, b) = (s.path[i], s.path[i + 1]);
                    let hit = near
                        .crossed(a, b)
                        .into_iter()
                        .filter_map(|k| g::segment_hit(a, b, e.path[k], e.path[k + 1]))
                        .map(|(t, _)| t)
                        .find(|&t| distance(lerp(a, b, t), mid) < 12.0);
                    let Some(t) = hit else {
                        i += 1;
                        continue;
                    };
                    let (wa, wb) = (width(s, i), width(s, i + 1));
                    let length = distance(a, b).max(EPS);
                    let at = |u: f64| u.clamp(0.0, 1.0);
                    // The passage, centred on its middle along the street.
                    let tm = g::distance(mid, a, b).1;
                    let (t0, t1) = (at(tm - half_len / length), at(tm + half_len / length));
                    let w = |u: f64| wa + (wb - wa) * u;
                    // Vertices inside the passage, in order along the segment.
                    let mut inserts: Vec<(Point, f64)> = vec![];
                    for u in [t0, t, t1] {
                        if u > 1e-6
                            && u < 1.0 - 1e-6
                            && inserts
                                .last()
                                .is_none_or(|&(p, _)| distance(p, lerp(a, b, u)) > 0.05)
                        {
                            inserts.push((lerp(a, b, u), w(u).min(cap)));
                        }
                    }
                    let n = inserts.len();
                    for (k, (p, wd)) in inserts.into_iter().enumerate() {
                        s.path.insert(i + 1 + k, p);
                        s.widths.insert(i + 1 + k, wd);
                    }
                    // Original vertices inside the passage are capped too.
                    if t0 <= 1e-6 {
                        s.widths[i] = s.widths[i].min(cap);
                    }
                    if t1 >= 1.0 - 1e-6 {
                        s.widths[i + 1 + n] = s.widths[i + 1 + n].min(cap);
                    }
                    i += n + 1;
                }
            }
        }
    }
}

/// A frequent intramural lane abuts the wall's inner face. Other seeds retain
/// plots against the enclosure; unsupported hillside fragments are discarded by
/// the shared network cleanup rather than inventing a dry crossing.
pub(in crate::urban) fn enclosure_lanes(
    streets: &mut Vec<Street>,
    enclosures: &[Enclosure],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    rng: &mut crate::rng::Rng,
) {
    use crate::urban::routing;
    for enclosure in enclosures {
        if !rng.chance(0.8) {
            continue;
        }
        let (shapes, w) = lane_line(enclosure);
        let w = if cfg.street_frontage { w.min(2.5) } else { w };
        for shape in shapes {
            let mut path = vec![];
            for (&a, &b) in shape
                .outer
                .iter()
                .zip(shape.outer.iter().cycle().skip(1))
                .take(shape.outer.len())
            {
                if routing::segment_clear(surface, a, b, cfg.max_street_grade) {
                    if path.is_empty() {
                        path.push(a);
                    }
                    path.push(b);
                } else if path.len() >= 2 {
                    streets.push(Street {
                        widths: vec![w; path.len()],
                        path: std::mem::take(&mut path),
                        rank: 2,
                        role: "wall-lane".into(),
                    });
                }
            }
            if path.len() >= 2 {
                streets.push(Street {
                    widths: vec![w; path.len()],
                    path,
                    rank: 2,
                    role: "wall-lane".into(),
                });
            }
        }
    }
}
