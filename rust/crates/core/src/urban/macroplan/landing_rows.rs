//! Service lanes and warehouse rows behind the quays.

use super::*;

/// Landing row behind each quay: a service lane at warehouse depth, closed on
/// a neighbouring town street or else on the quay ends, so the quay-side strip becomes its own block instead of
/// part of a large coastal block that one warehouse would absorb whole (the
/// programme refuses blocks over four times a facility). The row is sized by
/// the culture's own warehouse admission (frontage x depth of its native
/// witness) and certified before the lane is kept: simple, dry, inside its
/// quarter with usable land left behind it, lane within lane grade and the
/// fall from quay to lane within the admission slope. Otherwise nothing is
/// added and the quay keeps its coastal block.
pub(super) fn add_landing_rows(
    regions: &[Shape],
    streets: &mut Vec<Street>,
    roads: &[Street],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    m: &Morph,
    culture: &str,
) {
    const LANE: f64 = 4.0;
    let Some(profile) = super::super::culture::contextual_mapping(
        culture,
        &cfg.programme.period,
        "middle",
        m.text("plotOp"),
        "warehouse",
    )
    .map(|c| c.admissibility) else {
        return;
    };
    let (short, long) = (
        profile.min_frontage.min(profile.min_depth).max(6.0),
        profile.min_frontage.max(profile.min_depth).max(6.0),
    );
    let normal = |a: Point, b: Point| {
        let l = dist(a, b).max(1e-9);
        Point {
            x: -(b.y - a.y) / l,
            y: (b.x - a.x) / l,
        }
    };
    // Quays of one quarter along one shore form one row: consecutive
    // reaches (same heading, gap < one witness) chained in shore order.
    let mut quays: Vec<(usize, Vec<Point>, f64)> = streets
        .iter()
        .filter(|s| s.role == "quay" && s.path.len() >= 2)
        .filter_map(|s| {
            let mid = point(s.path[0], s.path[1], 0.5);
            let region = regions.iter().position(|r| g::contains(r, mid))?;
            Some((
                region,
                s.path.clone(),
                s.widths.iter().copied().fold(0.0, f64::max),
            ))
        })
        .collect();
    let mut chains: Vec<(usize, Vec<Point>, f64)> = vec![];
    quays.sort_by_key(|q| q.0);
    for region in quays
        .iter()
        .map(|q| q.0)
        .collect::<std::collections::BTreeSet<_>>()
    {
        let mut own: Vec<(Vec<Point>, f64)> = quays
            .iter()
            .filter(|q| q.0 == region)
            .map(|q| (q.1.clone(), q.2))
            .collect();
        let (a, b) = (own[0].0[0], *own[0].0.last().unwrap());
        let l = dist(a, b).max(1e-9);
        let axis = Point {
            x: (b.x - a.x) / l,
            y: (b.y - a.y) / l,
        };
        let along = |p: Point| p.x * axis.x + p.y * axis.y;
        for (path, _) in &mut own {
            if along(*path.last().unwrap()) < along(path[0]) {
                path.reverse();
            }
        }
        own.sort_by(|x, y| along(x.0[0]).total_cmp(&along(y.0[0])));
        for (path, width) in own {
            let heading = |p: &[Point]| {
                let (a, b) = (p[0], p[p.len() - 1]);
                let l = dist(a, b).max(1e-9);
                Point {
                    x: (b.x - a.x) / l,
                    y: (b.y - a.y) / l,
                }
            };
            if let Some(last) = chains.last_mut().filter(|c| {
                c.0 == region && dist(*c.1.last().unwrap(), path[0]) < short && {
                    let (h, k) = (heading(&c.1), heading(&path));
                    h.x * k.x + h.y * k.y >= 0.8
                }
            }) {
                last.1.extend(path);
                last.2 = last.2.max(width);
            } else {
                chains.push((region, path, width));
            }
        }
    }
    for (region, path, width) in chains {
        let region = &regions[region];
        let length: f64 = path.windows(2).map(|w| dist(w[0], w[1])).sum();
        // Clear land between the quay and lane ribbons holds the witness,
        // with a tenth spare for a shore that is not parallel to the lane.
        let depth = long * 1.1 + (width + LANE) * 0.5 + 1.0;
        if length < short + LANE + 1.0 {
            continue;
        }
        let mid = point(path[0], path[1], 0.5);
        let (first, last) = (path[0], path[path.len() - 1]);
        let chord = normal(first, last);
        let n0 = normal(path[0], path[1]);
        let inland = |side: f64| {
            let p = Point {
                x: mid.x + n0.x * side * depth * 0.5,
                y: mid.y + n0.y * side * depth * 0.5,
            };
            g::contains(region, p) && !surface.wet(p)
        };
        let side = if inland(1.0) {
            1.0
        } else if inland(-1.0) {
            -1.0
        } else {
            continue;
        };
        // Mitred parallel of the quay axis (quay reaches turn by < 45°), or
        // a straight lane parallel to the quay's chord on a curved reach.
        let parallel = |d: f64, straight: bool| -> Vec<Point> {
            if straight {
                return [first, last]
                    .iter()
                    .map(|p| Point {
                        x: p.x + chord.x * side * d,
                        y: p.y + chord.y * side * d,
                    })
                    .collect();
            }
            (0..path.len())
                .map(|i| {
                    let a = normal(path[i.saturating_sub(1)], path[i.max(1)]);
                    let b = if i + 1 < path.len() {
                        normal(path[i], path[i + 1])
                    } else {
                        a
                    };
                    let (x, y) = (a.x + b.x, a.y + b.y);
                    let l = x.hypot(y).max(1e-9);
                    let n = Point { x: x / l, y: y / l };
                    let mitre = (n.x * a.x + n.y * a.y).max(0.7);
                    Point {
                        x: path[i].x + n.x * side * d / mitre,
                        y: path[i].y + n.y * side * d / mitre,
                    }
                })
                .collect()
        };
        let fall = profile.max_slope.min(cfg.max_street_grade);
        let grade = cfg.max_lane_grade.max(cfg.max_street_grade);
        let on_quay = |p: Point| path.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 1e-6);
        let others: Vec<Street> = streets
            .iter()
            .chain(roads)
            .filter(|s| s.role != "quay" && !(s.path.len() == 2 && on_quay(s.path[0])))
            .cloned()
            .collect();
        // Each lane end returns to its quay end (a leg); where the leg would
        // leave the quarter (a street bounds it there) it closes on that
        // street instead. One leg at least keeps the quay on the network.
        let close = |b: Point, quay_end: Point| {
            if inside_path(region, &[quay_end, b]) {
                return Some((quay_end, true));
            }
            match nearest(b, &others) {
                Some((d, q, _))
                    if d > 0.5
                        && d < depth * 0.6
                        && routing::segment_clear(surface, b, q, grade) =>
                {
                    Some((q, false))
                }
                _ => None,
            }
        };
        for straight in [false, true] {
            let back = parallel(depth, straight);
            let (b0, b1) = (back[0], back[back.len() - 1]);
            let (Some((start, start_leg)), Some((end, end_leg))) =
                (close(b0, first), close(b1, last))
            else {
                continue;
            };
            let mut lane = vec![start];
            lane.extend(back.iter().copied());
            lane.push(end);
            let mut ring = path.clone();
            ring.extend(back.iter().rev().copied());
            let strip = Shape {
                outer: ring,
                holes: vec![],
            };
            let a = g::area(&strip);
            let certified = g::simple(&strip)
                && a >= length * depth * 0.7
                && inside_path(region, &back)
                && (start_leg || end_leg)
                && inside_path(region, &parallel(depth * 1.6, straight))
                && routing::path_clear(surface, &lane, grade)
                && path.iter().chain(&back).all(|&p| {
                    (surface.height_at(p) - surface.height_at(mid)).abs() <= fall * depth
                })
                && g::dry_clip(&surface, &strip)
                    .iter()
                    .map(g::area)
                    .sum::<f64>()
                    >= a * 0.98;
            if !certified {
                continue;
            }
            // The quay's landing street now starts from the lane, so the
            // strip stays one block; a landing that never reaches the lane
            // (a town street inside the strip) leaves the quay without a row.
            let links: Vec<usize> = (0..streets.len())
                .filter(|&i| {
                    let s = &streets[i];
                    s.role == "street" && s.path.len() == 2 && on_quay(s.path[0])
                })
                .collect();
            let mut joins = vec![];
            for &link in &links {
                let (p, q) = (streets[link].path[0], streets[link].path[1]);
                let hit = lane
                    .windows(2)
                    .enumerate()
                    .filter_map(|(k, w)| g::segment_hit(p, q, w[0], w[1]).map(|(t, x)| (k, t, x)))
                    .filter(|&(_, t, _)| t > 1e-6)
                    .min_by(|a, b| a.1.total_cmp(&b.1));
                match hit {
                    Some((k, _, x)) => joins.push((link, k, x)),
                    None => break,
                }
            }
            if joins.len() < links.len() {
                break;
            }
            // Insert the joints from the lane's far end so indices hold.
            joins.sort_by(|a, b| {
                b.1.cmp(&a.1)
                    .then(dist(lane[b.1], b.2).total_cmp(&dist(lane[a.1], a.2)))
            });
            for &(_, k, x) in &joins {
                lane.insert(k + 1, x);
            }
            joins.sort_by(|a, b| b.0.cmp(&a.0));
            for (link, _, x) in joins {
                let q = streets[link].path[1];
                if dist(x, q) > 1.0 {
                    streets[link].path = vec![x, q];
                } else {
                    streets.remove(link);
                }
            }
            // A row lane steeper than street grade is a lane, as in quarters.
            let street = routing::path_clear(surface, &lane, cfg.max_street_grade);
            streets.push(Street {
                widths: vec![LANE; lane.len()],
                path: lane,
                rank: if street { 2 } else { 3 },
                role: if street { "street" } else { "lane" }.into(),
            });
            break;
        }
    }
}
