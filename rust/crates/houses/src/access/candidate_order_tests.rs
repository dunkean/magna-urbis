use super::*;

// Frozen pre-ordering implementation. Keep its enumeration, full validation,
// and final stable sort independent of candidate_filtered's early return.
fn previous_candidate_filtered(
    a: &Surface,
    b: &Surface,
    width: f64,
    depth: f64,
    forbidden: &[Surface],
    accept: impl Fn([Point; 2], &Surface, [Point; 2]) -> bool,
) -> Option<([Point; 2], Surface)> {
    let mut options = vec![];
    let target_bounds = bounds(b);
    let target_geo = to_geo(b);
    for ring in rings(a) {
        for (start, end) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            if start.x.min(end.x) - depth > target_bounds[2]
                || start.x.max(end.x) + depth < target_bounds[0]
                || start.y.min(end.y) - depth > target_bounds[3]
                || start.y.max(end.y) + depth < target_bounds[1]
            {
                continue;
            }
            let length = libm::hypot(end.x - start.x, end.y - start.y);
            if length < 0.002 {
                continue;
            }
            let dx = (end.x - start.x) / length;
            let dy = (end.y - start.y) / length;
            let mut positions = vec![0.25, 0.5, 0.75];
            // A long boundary may face several rooms. Project their boundaries
            // into this segment rather than testing only its midpoint.
            for other in rings(b).flat_map(|r| r.iter()) {
                let t = ((other.x - start.x) * dx + (other.y - start.y) * dy) / length;
                for shift in [-width / length, 0.0, width / length] {
                    positions.push((t + shift).clamp(0.0, 1.0));
                }
            }
            positions.sort_by(f64::total_cmp);
            positions.dedup_by(|a, b| (*a - *b).abs() < 0.0001);
            for t in positions {
                let middle = point(
                    start.x + (end.x - start.x) * t,
                    start.y + (end.y - start.y) * t,
                );
                let opening = [
                    point(middle.x - dx * width * 0.5, middle.y - dy * width * 0.5),
                    point(middle.x + dx * width * 0.5, middle.y + dy * width * 0.5),
                ];
                let gap = if target_geo.contains(&geo::Point::new(middle.x, middle.y)) {
                    0.0
                } else {
                    rings(b)
                        .flat_map(|ring| {
                            ring.iter()
                                .zip(ring.iter().cycle().skip(1))
                                .take(ring.len())
                        })
                        .map(|(start, end)| {
                            let vx = end.x - start.x;
                            let vy = end.y - start.y;
                            let length2 = vx * vx + vy * vy;
                            let t = if length2 > 1e-12 {
                                ((middle.x - start.x) * vx + (middle.y - start.y) * vy) / length2
                            } else {
                                0.0
                            };
                            let t = t.clamp(0.0, 1.0);
                            libm::hypot(middle.x - start.x - t * vx, middle.y - start.y - t * vy)
                        })
                        .fold(f64::INFINITY, f64::min)
                };
                if gap > depth {
                    continue;
                }
                // Infer the source/target side from real opposed landings,
                // never from polygon winding or a guessed facade normal.
                let symmetric = segment_strip(opening[0], opening[1], 2.0 * (gap + 0.2));
                let sides = opposed_portal_sides(a, b, opening, &symmetric, width);
                let valid_common = |strip: &Surface| {
                    area(&intersection(strip, a)) >= width * 0.12
                        && area(&intersection(strip, b)) >= width * 0.12
                        && !forbidden.iter().any(|s| area(&intersection(s, strip)) > 0.003)
                        && accept(opening, strip, [*start, *end])
                };
                let asymmetric = sides.into_iter().enumerate().find_map(|(side, opposed)| {
                    if !opposed {
                        return None;
                    }
                    let (first, second) = if side == 0 { (0.2, gap + 0.2) } else { (gap + 0.2, 0.2) };
                    let strip = portal_strip_depths(opening, first, second);
                    (valid_common(&strip)
                        && has_opposed_portal_landings(a, b, opening, &strip, width))
                        .then_some(strip)
                });
                // A nonrectangular landing can require the larger native
                // passage. Retain it only when its final geometry proves ALL
                // the same guards; no site clipping or right is inferred here.
                let strip = asymmetric.or_else(|| {
                    // sides already proves the final predicate for this EXACT
                    // symmetric surface; keep full-strip/forbidden/profile
                    // guards and reuse only the identical opposed-side result.
                    sides.into_iter().any(|side| side).then(|| symmetric)
                        .filter(|strip| valid_common(strip))
                });
                if let Some(strip) = strip {
                    options.push((middle, opening, strip));
                }
            }
        }
    }
    options.sort_by(|a, b| b.0.y.total_cmp(&a.0.y).then(a.0.x.total_cmp(&b.0.x)));
    options
        .into_iter()
        .next()
        .map(|(_, opening, strip)| (opening, strip))
}

#[test]
fn ordered_proposals_match_previous_candidate_exactly() {
    fn rotated(surface: &Surface, angle: f64) -> Surface {
        let (sin, cos) = (libm::sin(angle), libm::cos(angle));
        let map = |p: &Point| point(p.x * cos - p.y * sin, p.x * sin + p.y * cos);
        surface.iter().map(|polygon| Polygon {
            outer: polygon.outer.iter().map(map).collect(),
            holes: polygon.holes.iter().map(|ring| ring.iter().map(map).collect()).collect(),
        }).collect()
    }

    let mut accepted = 0;
    let mut rejected = 0;
    // Gap, angle, reversed directions, partial/full obstacles, and immutable
    // caller-specific/profile predicates. Compare all coordinates, not a mask.
    for angle in [0.0, 0.41, std::f64::consts::FRAC_PI_2] {
        for gap in [0.316, 0.8] {
            let source = rotated(&rectangle(-2., -1., 4., 1.), angle);
            let target = rotated(&rectangle(-2., gap, 4., 1.), angle);
            for (a, b) in [(&source, &target), (&target, &source)] {
                for selector in 0..3 {
                    let forbidden = match selector {
                        1 => vec![rotated(&rectangle(-3., -0.5, 2., gap + 1.), angle)],
                        2 => vec![rectangle(-20., -20., 40., 40.)],
                        _ => vec![],
                    };
                    let accept = |opening: [Point; 2], passage: &Surface, edge: [Point; 2]| {
                        has_profiled_portal_landings(a, b, opening, passage, 0.85)
                            && (selector != 1 || (opening[0].x + opening[1].x >= -2.
                                && edge[0] != edge[1]))
                    };
                    let expected = previous_candidate_filtered(a, b, 1.2, 1.8, &forbidden, accept);
                    let actual = candidate_filtered(a, b, 1.2, 1.8, &forbidden, accept);
                    assert_eq!(actual, expected, "angle={angle}, gap={gap}, selector={selector}");
                    accepted += usize::from(actual.is_some());
                    rejected += usize::from(actual.is_none());
                    if selector == 2 { assert!(actual.is_none()); }
                }
            }
        }
    }
    // The real small-lot witness includes inner rings and coincident corner
    // priorities; a distant target also exercises rejection before geometry.
    let body = rectangle(0., 2.773, 7.966, 7.228);
    let lot = rectangle(-0.327, -0.327, 9.870, 10.655);
    let source = difference(&lot, &body);
    for target in [offset(&body, -0.316), translate(&body, 50., 50.)] {
        assert_eq!(candidate_filtered(&source, &target, 0.85, 1.8, &[], |_, _, _| true),
            previous_candidate_filtered(&source, &target, 0.85, 1.8, &[], |_, _, _| true));
    }
    assert!(accepted > 0 && rejected > 0);
}
