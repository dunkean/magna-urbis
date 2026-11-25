//! Siting individual shanty pockets, access paths and huts.

use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn pocket(
    layout: &mut Layout,
    candidate: Candidate,
    flavour: &str,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    streets: &[Street],
    forbidden: &[Shape],
    road_masks: &[Shape],
    obstacles: &[Shape],
    rng: &mut Rng,
    budget: usize,
) -> Option<Pocket> {
    let Candidate {
        point: c, axis: u, ..
    } = candidate;
    let v = normal(u);
    let length = rng.range(30., 68.) * cfg.shanty_scale.sqrt().clamp(0.65, 1.35);
    let depth = rng.range(17., 37.);
    let phase = rng.range(0., TAU);
    let outline = g::normalized(Shape {
        outer: (0..32)
            .map(|i| {
                let a = i as f64 * TAU / 32.;
                let wobble = 1. + 0.14 * (3. * a + phase).sin() + 0.08 * (5. * a - phase).cos();
                add(
                    add(c, u, length * a.cos() * wobble),
                    v,
                    depth * a.sin() * wobble,
                )
            })
            .collect(),
        holes: vec![],
    });
    let mut pieces = g::dry_clip(&surface, &outline);
    for mask in forbidden {
        if pieces.iter().any(|s| overlap(s, mask)) {
            pieces = pieces.iter().flat_map(|s| g::difference(s, mask)).collect();
        }
    }
    let shape = pieces
        .into_iter()
        .filter(|s| g::area(s) > 900.)
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
    let c = g::interior_point(&shape);
    let grade = if flavour == "gecekondu" && cfg.allow_stairs {
        cfg.max_stair_grade
    } else {
        cfg.max_lane_grade
    };
    let mut lane = (-3..=3)
        .map(|i| {
            add(
                add(c, u, i as f64 * length / 3.5),
                v,
                (i as f64 * 0.9 + phase).sin() * depth * 0.14,
            )
        })
        .collect::<Vec<_>>();
    // Keep the connected middle run if a shore/quarter cut bites an end.
    while lane.len() > 2 && !g::contains(&shape, lane[0]) {
        lane.remove(0);
    }
    while lane.len() > 2 && !g::contains(&shape, *lane.last().unwrap()) {
        lane.pop();
    }
    if !lane.iter().all(|&p| g::contains(&shape, p))
        || !lane
            .windows(2)
            .all(|ab| g::segment_within(&shape, ab[0], ab[1]))
        || !grade_path(surface, &lane, cfg.max_lane_grade)
    {
        return None;
    }
    let targets = road_targets(lane[0], streets);
    let mut entrance = None;
    for (_, goal, _) in targets {
        let start = lane[0];
        if distance(start, goal) > 230. {
            continue;
        }
        let path = vec![
            goal,
            Point {
                x: (goal.x + start.x) / 2.,
                y: (goal.y + start.y) / 2.,
            },
            start,
        ];
        if !grade_path(surface, &path, grade) {
            continue;
        }
        let corridor = g::ribbon(&path, &[2.4]);
        if corridor
            .iter()
            .any(|s| obstacles.iter().any(|b| overlap(s, b)))
        {
            continue;
        }
        entrance = Some(path);
        break;
    }
    let entrance = entrance?;
    let first_street = layout.streets.len();
    let mut local = vec![
        Street {
            path: entrance,
            widths: vec![2.4],
            rank: 3,
            role: "path".into(),
        },
        Street {
            path: lane.clone(),
            widths: vec![rng.range(3.0, 4.3)],
            rank: 3,
            role: "lane".into(),
        },
    ];
    // A small unbuilt court at the fork; no ornamental gardens in this tissue.
    let clearing = rectangle(
        lane[lane.len() / 2],
        u,
        rng.range(7., 10.),
        rng.range(6., 9.),
    );
    let clearings = if clearing.outer.iter().all(|&p| g::contains(&shape, p)) {
        vec![clearing]
    } else {
        vec![]
    };
    let mut huts: Vec<Hut> = vec![];
    let mut occupied: Vec<Shape> = vec![];
    let mut path_masks = local
        .iter()
        .flat_map(|s| g::ribbon(&s.path, &s.widths))
        .collect::<Vec<_>>();
    // Short branching closes form small compounds instead of Voronoi confetti.
    // On slopes these closes climb between the contour-aligned dirt lanes.
    let closes = rng.int(6, 11) as usize;
    for k in 0..closes {
        let x = -length * 0.78
            + k as f64 * length * 1.56 / (closes - 1) as f64
            + rng.range(-length * 0.07, length * 0.07);
        let root = lane
            .windows(2)
            .map(|ab| {
                let target = add(c, u, x);
                let (d, _, p) = g::distance(target, ab[0], ab[1]);
                (d, p)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))?
            .1;
        for side in [-1., 1.] {
            if rng.chance(0.12) {
                continue;
            }
            let end = add(
                add(root, v, side * depth * rng.range(0.65, 0.92)),
                u,
                rng.range(-4., 4.),
            );
            if !g::contains(&shape, end)
                || !g::segment_within(&shape, root, end)
                || !super::super::routing::segment_clear(surface, root, end, grade)
            {
                continue;
            }
            let middle = add(
                Point {
                    x: (root.x + end.x) * 0.5,
                    y: (root.y + end.y) * 0.5,
                },
                u,
                rng.range(-1.4, 1.4),
            );
            let branch = Street {
                path: vec![root, middle, end],
                widths: vec![1.1],
                rank: 4,
                role: "path".into(),
            };
            if !branch
                .path
                .windows(2)
                .all(|ab| g::segment_within(&shape, ab[0], ab[1]))
                || !grade_path(surface, &branch.path, grade)
            {
                continue;
            }
            let branch_masks = g::ribbon(&branch.path, &branch.widths);
            if occupied
                .iter()
                .any(|s| branch_masks.iter().any(|p| overlap(s, p)))
            {
                continue;
            }
            let street = first_street + local.len();
            let mask_count = path_masks.len();
            let hut_count = huts.len();
            path_masks.extend(branch_masks);
            local.push(branch);
            let along = unit(Point {
                x: end.x - root.x,
                y: end.y - root.y,
            });
            let across = normal(along);
            let mut station = rng.range(5.0, 6.0);
            for step in 0..4 {
                if step > 0 {
                    station += rng.range(6.2, 8.4);
                }
                if station > distance(root, end) - 1. {
                    break;
                }
                for flank in [-1., 1.] {
                    if huts.len() >= budget.min(90) {
                        break;
                    }
                    let p = add(
                        add(root, along, station),
                        across,
                        flank * rng.range(3.0, 4.0),
                    );
                    let edge = forbidden
                        .iter()
                        .filter(|s| g::area(s) > 100.)
                        .flat_map(|s| {
                            s.outer
                                .iter()
                                .zip(s.outer.iter().cycle().skip(1))
                                .take(s.outer.len())
                        })
                        .map(|(&a, &b)| g::distance(p, a, b).0)
                        .fold(200., f64::min);
                    let density = (0.94 - edge / 330. - station / 120.).clamp(0.35, 0.93);
                    if !rng.chance(density) {
                        continue;
                    }
                    let w = rng.range(3.2, 6.6);
                    let d = rng.range(3.7, 6.7);
                    let theta = rng.range(-0.23, 0.23);
                    let axis = Point {
                        x: across.x * theta.cos() - across.y * theta.sin(),
                        y: across.x * theta.sin() + across.y * theta.cos(),
                    };
                    let hut = rectangle(p, axis, w, d);
                    let pad = rectangle(p, axis, w + 0.7, d + 0.7);
                    if !hut.outer.iter().all(|&p| g::contains(&shape, p))
                        || !hut
                            .outer
                            .iter()
                            .enumerate()
                            .all(|(i, &a)| g::segment_within(&shape, a, hut.outer[(i + 1) % 4]))
                        || !dry_shape(surface, &hut, 0.65)
                        || path_masks
                            .iter()
                            .chain(road_masks)
                            .chain(&clearings)
                            .chain(&occupied)
                            .any(|s| overlap(&pad, s))
                    {
                        continue;
                    }
                    let front = if flank > 0. {
                        [hut.outer[3], hut.outer[0]]
                    } else {
                        [hut.outer[1], hut.outer[2]]
                    };
                    let id = format!(
                        "{}/shanty/{}/hut/{}",
                        layout.key,
                        layout.quarters.len(),
                        huts.len()
                    );
                    occupied.push(pad);
                    huts.push(Hut {
                        id,
                        shape: hut,
                        axis,
                        front,
                        street,
                    });
                }
            }
            if hut_count == huts.len() {
                local.pop();
                path_masks.truncate(mask_count);
            }
        }
    }
    // Compact infill grows off the closes. Staggered, jittered stations leave
    // narrow shared passages, while short spurs reach the remaining compounds.
    // The initial closes alone would leave large empty lawns between sheds.
    let columns = (2. * length / 5.9).ceil() as usize;
    let rows = (2. * depth / 6.2).ceil() as usize;
    let inward = unit(Point {
        x: layout.center.x - c.x,
        y: layout.center.y - c.y,
    });
    for row in 0..rows.min(16) {
        for column in 0..columns.min(36) {
            if huts.len() >= budget.min(90) {
                break;
            }
            let x = -length
                + (column as f64 + 0.5) * 5.9
                + (row % 2) as f64 * 2.6
                + rng.range(-0.65, 0.65);
            let y = -depth + (row as f64 + 0.5) * 6.2 + rng.range(-0.65, 0.65);
            let p = add(add(c, u, x), v, y);
            if !g::contains(&shape, p) {
                continue;
            }
            let nearest = local
                .iter()
                .enumerate()
                .flat_map(|(i, s)| {
                    s.path.windows(2).map(move |ab| {
                        let (d, _, goal) = g::distance(p, ab[0], ab[1]);
                        (d, goal, i)
                    })
                })
                .min_by(|a, b| a.0.total_cmp(&b.0));
            let Some((gap, goal, way)) = nearest else {
                continue;
            };
            if gap > 16. {
                continue;
            }
            let outward = -((p.x - c.x) * inward.x + (p.y - c.y) * inward.y) / length.max(depth);
            let density = (0.97 - gap / 90. - (y / depth).powi(2) * 0.2 - outward.max(0.) * 0.25)
                .clamp(0.5, 0.94);
            if !rng.chance(density) {
                continue;
            }
            let angle = rng.range(-0.16, 0.16);
            let axis = Point {
                x: u.x * angle.cos() - u.y * angle.sin(),
                y: u.x * angle.sin() + u.y * angle.cos(),
            };
            let w = rng.range(3.4, 5.4);
            let d = rng.range(3.9, 5.8);
            let hut = rectangle(p, axis, w, d);
            let pad = rectangle(p, axis, w + 0.45, d + 0.45);
            if !hut.outer.iter().enumerate().all(|(i, &a)| {
                g::contains(&shape, a) && g::segment_within(&shape, a, hut.outer[(i + 1) % 4])
            }) || !dry_shape(surface, &hut, 0.65)
                || path_masks
                    .iter()
                    .chain(road_masks)
                    .chain(&clearings)
                    .chain(&occupied)
                    .any(|s| overlap(&pad, s))
            {
                continue;
            }
            let front = (0..4)
                .map(|i| [hut.outer[i], hut.outer[(i + 1) % 4]])
                .min_by(|a, b| {
                    let middle = |e: &[Point; 2]| Point {
                        x: (e[0].x + e[1].x) * 0.5,
                        y: (e[0].y + e[1].y) * 0.5,
                    };
                    distance(middle(a), goal).total_cmp(&distance(middle(b), goal))
                })
                .unwrap();
            let door = Point {
                x: (front[0].x + front[1].x) * 0.5,
                y: (front[0].y + front[1].y) * 0.5,
            };
            if !g::segment_within(&shape, goal, door)
                || !super::super::routing::segment_clear(surface, goal, door, grade)
            {
                continue;
            }
            let spur = Street {
                path: vec![goal, door],
                widths: vec![0.85],
                rank: 4,
                role: "path".into(),
            };
            let corridor = g::ribbon(&spur.path, &spur.widths);
            if corridor
                .iter()
                .any(|s| occupied.iter().any(|h| overlap(s, h)))
            {
                continue;
            }
            let street = if distance(goal, door) > 0.7 {
                let street = first_street + local.len();
                path_masks.extend(corridor);
                local.push(spur);
                street
            } else {
                first_street + way
            };
            let id = format!(
                "{}/shanty/{}/hut/{}",
                layout.key,
                layout.quarters.len(),
                huts.len()
            );
            occupied.push(pad);
            huts.push(Hut {
                id,
                shape: hut,
                axis,
                front,
                street,
            });
        }
    }
    if huts.len() < 6 {
        return None;
    }
    prune_paths(&mut local, streets, &mut huts, &clearings, first_street);
    let quarter = layout.quarters.len();
    let block = layout.blocks.len();
    let phase = layout.quarters.first().map_or(0, |q| q.phase);
    layout.quarters.push(Quarter {
        shape: shape.clone(),
        phase,
        zone: "shanty".into(),
    });
    layout.blocks.push(Block {
        shape,
        quarter,
        kind: "shanty".into(),
        axis: u,
        zone: "shanty".into(),
        phase: Some(phase),
    });
    layout.streets.extend(local);
    let structure = layout.structure.get_or_insert_with(UrbanStructure::default);
    let id = structure.districts.len();
    structure.districts.push(UrbanDistrict {
        id,
        center: 0,
        phase,
        tissue: "organic".into(),
        quarters: vec![quarter],
        role: "shanty".into(),
        wealth: 0.08,
        label: catalogue()["shanty"][flavour]["label"]
            .as_str()
            .unwrap_or("Habitat informel")
            .into(),
    });
    Some(Pocket {
        quarter,
        block,
        flavour: flavour.into(),
        huts,
        clearings,
    })
}
