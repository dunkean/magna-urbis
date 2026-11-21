//! Cultural dead-end access, including closes, derbs and roji.

use super::field::Field;
use super::frames::frame;
use super::streets::add;
use super::subdivision::Piece;
use crate::rng::Rng;
use crate::urban::{LayoutConfig, Morph, Point, Street, generation_limits, geometry as g};

/// Close operator, including the dead-end trees that a preset lists among its
/// street operators (medina, ksar, Mesopotamia) while `closeOp` stays `none`.
fn close_op(m: &Morph) -> &str {
    let listed = |k: &str| {
        m.value["streets"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(k)))
    };
    match m.text("closeOp") {
        "none" if listed("culDeSacTree") => "culDeSacTree",
        "none" if listed("roji") => "roji",
        "none" if listed("closes") => "closes",
        op => op,
    }
}
pub(super) fn closes(
    pieces: &[Piece],
    streets: &mut Vec<Street>,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    rng: &mut Rng,
) {
    let m = field.p;
    let op = close_op(m);
    if op == "none" {
        return;
    }
    if op != "closes" {
        tree_closes(pieces, streets, m, op, field, rng);
        return;
    }
    for pc in pieces {
        if pc.kind != "block" || !rng.chance(m.number("deadEndRatio")) {
            continue;
        }
        let f = frame(&pc.shape);
        let pd = m.range(
            "plotDepth",
            if cfg.zone == "auto" {
                "middle"
            } else {
                &cfg.zone
            },
        )[1];
        if f.hv < pd * 0.95 && op == "closes" {
            continue;
        }
        let mut edges: Vec<_> = pc
            .shape
            .outer
            .iter()
            .zip(pc.shape.outer.iter().cycle().skip(1))
            .take(pc.shape.outer.len())
            .filter_map(|(&a, &b)| {
                let p = Point {
                    x: (a.x + b.x) * 0.5,
                    y: (a.y + b.y) * 0.5,
                };
                let l = (a.x - b.x).hypot(a.y - b.y);
                let near = field.street_distance(p, streets, 4, 0.3);
                if near.is_some_and(|d| d < 0.3) {
                    Some((l, a, b))
                } else {
                    None
                }
            })
            .collect();
        edges.sort_by(|a, b| b.0.total_cmp(&a.0));
        let Some((l, a, b)) = edges.first().copied() else {
            continue;
        };
        if l < 25.0 {
            continue;
        }
        let t = rng.range(0.35, 0.65);
        let s = Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
        let n = Point {
            x: -(b.y - a.y) / l,
            y: (b.x - a.x) / l,
        };
        let far = Point {
            x: s.x + n.x * 10000.0,
            y: s.y + n.y * 10000.0,
        };
        let hit = pc
            .shape
            .outer
            .iter()
            .zip(pc.shape.outer.iter().cycle().skip(1))
            .take(pc.shape.outer.len())
            .filter_map(|(&a, &b)| g::segment_hit(s, far, a, b))
            .min_by(|a, b| a.0.total_cmp(&b.0));
        let Some((_, h)) = hit else { continue };
        let dist = (h.x - s.x).hypot(h.y - s.y);
        let length = (dist * m.number("slitDepth")).min(dist - 16.0).min(70.0);
        if length < 18.0 {
            continue;
        }
        let end = Point {
            x: s.x + n.x * length,
            y: s.y + n.y * length,
        };
        // `roadMouths`: the mouth sits on the street's axis; a start 2 m past it
        // notches the opposite block of a street narrower than 4 m.
        let start = if cfg.road_mouths { s } else { Point { x: s.x - n.x * 2.0, y: s.y - n.y * 2.0 } };
        add(streets, vec![start, end], 4, "close", m, rng);
    }
}

/// Shadow-distance access tree; hutong is cardinal, roji follows the local frontage.
fn tree_closes(
    pieces: &[Piece],
    streets: &mut Vec<Street>,
    m: &Morph,
    op: &str,
    field: &Field<'_>,
    rng: &mut Rng,
) {
    let orthogonal = op == "hutong" || op == "roji";
    let depth = m.number("accessDepth").max(4.0);
    let width = m.value["widthByRank"][4].as_f64().unwrap_or(3.0) * m.number("widthScale");
    for pc in pieces.iter().filter(|p| p.kind == "block") {
        let ring = &pc.shape.outer;
        let boundary_distance = |p| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(&a, &b)| g::distance(p, a, b).0)
                .fold(f64::INFINITY, f64::min)
        };
        let mut access = vec![];
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let l = (b.x - a.x).hypot(b.y - a.y);
            if l < 4.0 {
                continue;
            }
            let mid = Point {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
            };
            let near = field.street_distance(mid, streets, 3, 0.3);
            if near.is_none_or(|d| d > 0.3) {
                continue;
            }
            let margin = if orthogonal { width * 0.5 + 7.5 } else { 0.0 };
            if l <= 2.0 * margin {
                continue;
            }
            let dir = Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            };
            access.push((
                Point {
                    x: a.x + dir.x * margin,
                    y: a.y + dir.y * margin,
                },
                Point {
                    x: b.x - dir.x * margin,
                    y: b.y - dir.y * margin,
                },
                Point {
                    x: -dir.y,
                    y: dir.x,
                },
            ));
        }
        if access.is_empty() {
            continue;
        }
        let axis = if op == "roji" {
            let &(a, b, _) = access
                .iter()
                .max_by(|a, b| {
                    (a.1.x - a.0.x)
                        .hypot(a.1.y - a.0.y)
                        .total_cmp(&(b.1.x - b.0.x).hypot(b.1.y - b.0.y))
                })
                .unwrap();
            let l = (b.x - a.x).hypot(b.y - a.y);
            Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            }
        } else {
            Point { x: 1.0, y: 0.0 }
        };
        let across = Point {
            x: -axis.y,
            y: axis.x,
        };
        let (x0, y0, x1, y1) = g::bbox(&pc.shape);
        let mut samples = vec![];
        // Four metre samples as in the source; cap only the lattice resolution on oversized wards.
        let step = 4.0_f64.max(((x1 - x0) * (y1 - y0) / 100_000.0).sqrt());
        for p in generation_limits::samples((x0, y0, x1, y1), step, 100_000) {
                if g::contains(&pc.shape, p) && boundary_distance(p) > 2.0 {
                    let d = access
                        .iter()
                        .map(|&(a, b, _)| g::distance(p, a, b).0)
                        .fold(f64::INFINITY, f64::min);
                    samples.push((p, d));
                }
        }
        let mut slits: Vec<Vec<Point>> = vec![];
        let budget = if op == "roji" {
            ((samples.len() as f64 * step * step / (depth * depth)).ceil() as usize).clamp(60, 160)
        } else {
            60
        };
        for _ in 0..budget {
            let Some((bi, &(target, _))) = samples
                .iter()
                .enumerate()
                .filter(|(_, s)| s.1 > depth)
                .max_by(|a, b| a.1.1.total_cmp(&b.1.1))
            else {
                break;
            };
            let mut roots: Vec<_> = access
                .iter()
                .map(|&(a, b, n)| {
                    let (d, _, q) = g::distance(target, a, b);
                    (d, q, Some(n), None)
                })
                .collect();
            for (si, path) in slits.iter().enumerate() {
                for q in path.windows(2) {
                    let (d, _, p) = g::distance(target, q[0], q[1]);
                    roots.push((d + 3.0, p, None, Some(si)));
                }
            }
            roots.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut selected = None;
            for (_, root, n, parent) in roots.into_iter().take(if op == "roji" { 12 } else { 1 }) {
                let l = (target.x - root.x).hypot(target.y - root.y);
                let stop = (l - 4.0).min(l - depth * 0.35).min(if op == "roji" {
                    2.0 * depth
                } else {
                    f64::INFINITY
                });
                if stop < 8.0 {
                    continue;
                }
                let dir = Point {
                    x: (target.x - root.x) / l,
                    y: (target.y - root.y) / l,
                };
                let end = Point {
                    x: root.x + dir.x * stop,
                    y: root.y + dir.y * stop,
                };
                let start = n
                    .map(|n| Point {
                        x: root.x - n.x * width * 0.5,
                        y: root.y - n.y * width * 0.5,
                    })
                    .unwrap_or(root);
                let mut alternatives = vec![];
                if orthogonal {
                    let entry = n
                        .map(|n| Point {
                            x: root.x + n.x * (width * 0.5 + 7.5),
                            y: root.y + n.y * (width * 0.5 + 7.5),
                        })
                        .unwrap_or(root);
                    for d in [axis, across] {
                        let amount = (end.x - entry.x) * d.x + (end.y - entry.y) * d.y;
                        let bend = Point {
                            x: entry.x + d.x * amount,
                            y: entry.y + d.y * amount,
                        };
                        alternatives.push(vec![start, root, entry, bend, end]);
                        if op == "roji" && amount.abs() > 8.0 {
                            alternatives.push(vec![start, root, entry, bend]);
                        }
                    }
                } else if stop > 22.0 && rng.chance(0.55) {
                    let off = rng.range(-0.22, 0.22) * stop;
                    alternatives.push(vec![
                        start,
                        Point {
                            x: (root.x + end.x) * 0.5 - dir.y * off,
                            y: (root.y + end.y) * 0.5 + dir.x * off,
                        },
                        end,
                    ]);
                } else {
                    alternatives.push(vec![start, end]);
                }
                for mut path in alternatives {
                    path.dedup_by(|a, b| (a.x - b.x).hypot(a.y - b.y) < 0.05);
                    let valid = path.windows(2).all(|q| {
                        let l = (q[1].x - q[0].x).hypot(q[1].y - q[0].y);
                        let k = (l / 2.0).ceil().max(1.0) as usize;
                        (0..=k).all(|i| {
                            let t = i as f64 / k as f64;
                            let p = Point {
                                x: q[0].x + (q[1].x - q[0].x) * t,
                                y: q[0].y + (q[1].y - q[0].y) * t,
                            };
                            let along = (p.x - start.x).hypot(p.y - start.y);
                            if along
                                < if n.is_some() {
                                    width + 8.0
                                } else {
                                    width + 6.0
                                }
                            {
                                return true;
                            }
                            g::contains(&pc.shape, p)
                                && boundary_distance(p) >= width * 0.5 + 6.5
                                && slits.iter().enumerate().all(|(si, s)| {
                                    if Some(si) == parent && along <= 10.0 {
                                        return true;
                                    }
                                    s.windows(2).all(|q| {
                                        g::distance(p, q[0], q[1]).0
                                            >= if Some(si) == parent {
                                                width + 6.0
                                            } else {
                                                width + 12.0
                                            }
                                    })
                                })
                        })
                    });
                    if valid {
                        selected = Some(path);
                        break;
                    }
                }
                if selected.is_some() {
                    break;
                }
            }
            if let Some(path) = selected {
                for (p, d) in &mut samples {
                    for q in path.windows(2) {
                        *d = d.min(g::distance(*p, q[0], q[1]).0);
                    }
                }
                add(streets, path.clone(), 4, "close", m, rng);
                slits.push(path);
            } else {
                for (p, d) in &mut samples {
                    if (p.x - target.x).hypot(p.y - target.y) < 9.0 {
                        *d = 0.0
                    }
                }
                samples[bi].1 = 0.0;
            }
        }
    }
}
