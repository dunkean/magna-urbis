//! Continuous metric junction widths, applied before street land is carved.
use super::{Point, Street};
use std::collections::BTreeMap;

fn key(p: Point) -> (i64, i64) {
    (
        (p.x * 10000.0).round() as i64,
        (p.y * 10000.0).round() as i64,
    )
}
fn fixed(s: &Street) -> bool {
    matches!(
        s.role.as_str(),
        "regional" | "bridge" | "ford" | "causeway" | "stairs" | "quay"
    )
}
fn width(s: &Street, i: usize) -> f64 {
    s.widths
        .get(i)
        .copied()
        .or_else(|| s.widths.last().copied())
        .unwrap_or(4.0)
}
#[derive(Clone, Copy)]
struct Arm {
    street: usize,
    vertex: usize,
    dx: f64,
    dy: f64,
}

pub(super) fn harmonize(streets: &mut [Street]) {
    let mut nodes: BTreeMap<_, Vec<Arm>> = BTreeMap::new();
    for (street, s) in streets.iter().enumerate() {
        for (i, pair) in s.path.windows(2).enumerate() {
            let dx = pair[1].x - pair[0].x;
            let dy = pair[1].y - pair[0].y;
            let length = dx.hypot(dy);
            if length < 1e-6 {
                continue;
            }
            for (vertex, sign) in [(i, 1.0), (i + 1, -1.0)] {
                nodes.entry(key(s.path[vertex])).or_default().push(Arm {
                    street,
                    vertex,
                    dx: dx / length * sign,
                    dy: dy / length * sign,
                });
            }
        }
    }
    let mut targets: Vec<BTreeMap<usize, f64>> = vec![BTreeMap::new(); streets.len()];
    for arms in nodes.values().filter(|a| a.len() >= 2) {
        for &a in arms {
            let s = &streets[a.street];
            if fixed(s) {
                continue;
            }
            let base = width(s, a.vertex);
            let continuation = arms
                .iter()
                .filter(|b| b.street != a.street && a.dx * b.dx + a.dy * b.dy < -0.85)
                .min_by(|b, c| (a.dx * b.dx + a.dy * b.dy).total_cmp(&(a.dx * c.dx + a.dy * c.dy)));
            let target = if let Some(b) = continuation {
                let other = &streets[b.street];
                if fixed(other) || other.rank < s.rank {
                    width(other, b.vertex)
                } else if other.rank == s.rank {
                    base.max(width(other, b.vertex))
                } else {
                    base
                }
            } else if arms.len() >= 3 {
                // A small side lane gets a modest mouth, not an arterial-sized
                // corridor extending into its entire block.
                arms.iter()
                    .map(|b| width(&streets[b.street], b.vertex))
                    .fold(base, f64::max)
                    .min(base * 1.5)
            } else {
                base
            };
            if (target - base).abs() > 0.05 {
                targets[a.street].insert(a.vertex, target);
            }
        }
    }
    for (s, targets) in streets.iter_mut().zip(targets) {
        apply(s, &targets);
    }
}
pub(super) fn taper_end(s: &mut Street, target: f64) {
    if s.path.len() < 2 {
        return;
    }
    apply(s, &BTreeMap::from([(s.path.len() - 1, target)]));
}
fn apply(s: &mut Street, targets: &BTreeMap<usize, f64>) {
    if targets.is_empty() {
        return;
    }
    let mut stations = vec![0.0];
    for p in s.path.windows(2) {
        stations.push(stations.last().unwrap() + (p[1].x - p[0].x).hypot(p[1].y - p[0].y));
    }
    let changes: Vec<_> = targets
        .iter()
        .map(|(&i, &w)| {
            (
                stations[i],
                w,
                width(s, i),
                (6.0 * (w - width(s, i)).abs()).max(12.0),
            )
        })
        .collect();
    let total = *stations.last().unwrap();
    let mut cuts = stations.clone();
    for &(at, _, _, run) in &changes {
        for sign in [-1.0, 1.0] {
            for t in [0.25, 0.5, 0.75, 1.0] {
                cuts.push((at + sign * run * t).clamp(0.0, total));
            }
        }
    }
    cuts.sort_by(f64::total_cmp);
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
    let mut path = vec![];
    let mut widths = vec![];
    let mut i = 0;
    for at in cuts {
        while i + 2 < stations.len() && stations[i + 1] < at - 1e-6 {
            i += 1;
        }
        let t = ((at - stations[i]) / (stations[i + 1] - stations[i]).max(1e-6)).clamp(0.0, 1.0);
        let a = s.path[i];
        let b = s.path[i + 1];
        path.push(Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        });
        let base = width(s, i) * (1.0 - t) + width(s, i + 1) * t;
        // The strongest local transition wins. At a
        // prescribed junction its own width takes precedence exactly.
        let value = changes
            .iter()
            .filter(|(p, _, _, _)| (at - p).abs() < 1e-6)
            .map(|(_, w, _, _)| *w)
            .next()
            .unwrap_or_else(|| {
                changes
                    .iter()
                    .map(|&(p, target, _original, run)| {
                        let u = (1.0 - (at - p).abs() / run).clamp(0.0, 1.0);
                        let blend = u * u * (3.0 - 2.0 * u);
                        (
                            base + (target - base) * blend,
                            (target - base).abs() * blend,
                        )
                    })
                    .max_by(|a, b| a.1.total_cmp(&b.1))
                    .map_or(base, |v| v.0)
            });
        widths.push(value);
    }
    s.path = path;
    s.widths = widths;
}

#[cfg(test)]
mod tests {
    use super::*;
    fn street(points: &[(f64, f64)], w: f64, role: &str) -> Street {
        Street {
            path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            widths: vec![w; points.len()],
            rank: 2,
            role: role.into(),
        }
    }
    #[test]
    fn quay_keeps_its_shore_clearance_at_a_wide_road_junction() {
        let quay = street(&[(0., 0.), (60., 0.)], 4.5, "quay");
        let mut streets = vec![
            quay.clone(),
            street(&[(60., 0.), (120., 0.)], 10., "street"),
            street(&[(60., 0.), (60., 80.)], 8., "street"),
        ];
        harmonize(&mut streets);
        assert_eq!(streets[0].widths, quay.widths);
        assert_eq!(streets[0].path, quay.path);
    }
    #[test]
    fn peripheral_continuation_keeps_imported_width_and_tapers_before_its_next_junction() {
        let regional = street(&[(0.0, 0.0), (100.0, 0.0)], 8.0, "regional");
        let mut streets = vec![
            regional.clone(),
            street(&[(100.0, 0.0), (200.0, 0.0)], 4.0, "outbound"),
        ];
        harmonize(&mut streets);
        assert_eq!(streets[0].widths, regional.widths);
        assert_eq!(streets[0].path.len(), regional.path.len());
        assert_eq!(streets[1].widths[0], 8.0);
        assert_eq!(*streets[1].widths.last().unwrap(), 4.0);
        assert!(streets[1].widths.windows(2).all(|w| w[1] <= w[0]));
        assert!(streets[1].path.len() > 2);
        let mut narrowing = street(&[(0.0, 0.0), (100.0, 0.0)], 8.0, "outbound");
        taper_end(&mut narrowing, 2.0);
        assert_eq!(narrowing.widths[0], 8.0);
        assert_eq!(*narrowing.widths.last().unwrap(), 2.0);
        assert!(narrowing.widths.windows(2).all(|w| w[1] <= w[0]));
    }
}
