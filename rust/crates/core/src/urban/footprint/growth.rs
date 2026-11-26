//! Accessible growth by least-cost arrival, including land budgets and crossings.
use super::contours::smooth_growth;
use super::geometry::{distance, dry, rotate, subtract, union};
use super::lattice::{Arrival, Grid, RoadField, ShoreField, fill_holes};
use super::site::{cave_floor_share, slope};
use super::{crossings, sparse, terrain};
use crate::rng::Rng;
use crate::urban::{
    LayoutConfig, Point, Shape, Street, Surface, UrbanCenter, geometry as g, macroplan, neighbours,
    routing,
};
use std::collections::BinaryHeap;

/// Physical service rules of accessible growth.
#[derive(Clone, Copy)]
pub(super) struct Service {
    /// Steepest grade of a growth move (street grade, or stair grade where allowed).
    pub(super) grade: f64,
    /// Enclosed open land smaller than this (m², about one block) is absorbed.
    pub(super) min_gap: f64,
    /// Half-width of the faubourg ribbons along approach roads; zero disables.
    pub(super) suburb_band: f64,
    /// Urban crossings the town may build over narrow water.
    pub(super) crossing: crossings::Rules,
}

#[allow(clippy::too_many_arguments)]
fn smooth_step(v: f64, lo: f64, hi: f64) -> f64 {
    let t = ((v - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
/// The growth lattice and the cells it selected, in arrival order.
pub(super) struct Taken {
    pub grid: Grid,
    pub cells: Vec<usize>,
}

/// Accessible growth: reserve window, epoch land, built crossings, whether
/// the growth stopped on its housable-land goal (`terrain::Flood`), and the
/// housable shares of the cells it took under `gate`.
pub(super) type Growth = (Vec<Shape>, Vec<Vec<Shape>>, Vec<Street>, bool, Option<(terrain::Survey, Taken)>);
/// `flood` (a site the strict house gate refuses, `terrain`): cells are priced
/// up by their block-scale slope class, so flat land is taken first, and the
/// growth stops as soon as its housable land reaches the goal; the area
/// target stays the upper bound. Without it the growth is area-bounded only.
#[allow(clippy::too_many_arguments)]

pub(super) fn accessible(
    site_population: u32,
    target: f64,
    family: &str,
    cfg: &LayoutConfig,
    centers: &mut Vec<UrbanCenter>,
    radius: f64,
    angle: f64,
    fractions: &[f64],
    surface: Surface<'_>,
    roads: &[Street],
    rng: &Rng,
    grade_limit: f64,
    water_affinity: f64,
    service: Service,
    capacity_seed: bool,
    gate: Option<terrain::Gate>,
    flood: Option<terrain::Flood>,
    neighbours: Option<&neighbours::Mask>,
    fixed_center: bool,
) -> Growth {
    // A small settlement is a compact cluster: its growth window and its far-field cost shrink
    // with its population, so a thin buildable strip (a road bench, a contour) is not stretched
    // into a corridor much longer than the village is wide.
    let small = 1.0 - smooth_step(site_population as f64, 600.0, 1200.0);
    let aspect = if matches!(family, "elongated" | "linear") {
        cfg.footprint.aspect.max(2.8)
    } else {
        cfg.footprint.aspect
    };
    let aspect = aspect + (aspect.min(1.4) - aspect) * small;
    let window = radius * 2.65 * aspect.sqrt();
    // Underdark: the town follows the galleries to the next chambers. The window widens with
    // the rock around it (the inverse square root of the open share), up to `CAVE_SPREAD`.
    let window = window * centers.first().and_then(|c| cave_floor_share(surface, c.point, window))
        .map_or(1.0, |share| (1.0 / share.max(1e-3).sqrt()).min(crate::settlements::CAVE_SPREAD));
    let reach = window * (1.0 - 0.35 * small);
    let mut x0 = centers
        .iter()
        .map(|c| c.point.x - window)
        .fold(f64::INFINITY, f64::min)
        .max(0.0);
    let mut y0 = centers
        .iter()
        .map(|c| c.point.y - window)
        .fold(f64::INFINITY, f64::min)
        .max(0.0);
    let x1 = centers
        .iter()
        .map(|c| c.point.x + window)
        .fold(f64::NEG_INFINITY, f64::max)
        .min(surface.width);
    let y1 = centers
        .iter()
        .map(|c| c.point.y + window)
        .fold(f64::NEG_INFINITY, f64::max)
        .min(surface.width);
    let step = ((x1 - x0).max(y1 - y0) / 192.0).max(1.0);
    x0 = (x0 / step).floor() * step;
    y0 = (y0 / step).floor() * step;
    let grid = Grid {
        x0,
        y0,
        step,
        nx: (((x1 - x0) / step).ceil() as usize).clamp(1, 192),
        ny: (((y1 - y0) / step).ceil() as usize).clamp(1, 192),
    };
    let n = grid.nx * grid.ny;
    let field = RoadField::new(roads, &grid, radius * 0.35);
    let shore = ShoreField::new(&grid, surface, macroplan::harbour::port_town(cfg));
    let noise = crate::noise::Noise::new(rng.fork("growth-cost"));
    let mut dry_mask = vec![false; n];
    let mut heights = vec![0.0; n];
    let mut costs = vec![1.0; n];
    let porous = sparse::enabled(cfg);
    let strongest = centers.iter().map(|c| c.weight).fold(0.0, f64::max);
    let open_space = crate::noise::Noise::new(rng.fork("growth-open-space"));
    let mut occupied = vec![true; n];
    let mut road_distance = vec![0.0; n];
    // Cells whose block-scale slope the town's house gate admits (`flood` only).
    let mut housable = vec![false; n];
    for i in 0..n {
        let p = grid.point(i);
        let mut grade: f64 = 0.0;
        for (dx, dy) in [
            (0.0, 0.0),
            (0.35, 0.0),
            (-0.35, 0.0),
            (0.0, 0.35),
            (0.0, -0.35),
        ] {
            let (gx, gy) = slope(
                surface,
                Point {
                    x: p.x + dx * step,
                    y: p.y + dy * step,
                },
            );
            grade = grade.max(gx.hypot(gy));
        }
        dry_mask[i] = !surface.wet(p) && grade <= grade_limit && neighbours.is_none_or(|m| !m.blocked(p));
        heights[i] = surface.height_at(p);
        let rd = field.distance(p);
        road_distance[i] = rd;
        let road_attraction = if family == "linear" {
            0.95
        } else if matches!(family, "fingers" | "dendritic") {
            0.8
        } else {
            0.55
        };
        let attraction = 1.0
            - cfg.footprint.anisotropy * road_attraction * (-rd / (radius * 0.07).max(step)).exp();
        let branches =
            1.0 - cfg.footprint.branch_depth * 0.85 * (-rd / (radius * 0.06).max(step)).exp();
        let scale = radius.max(1.0);
        let broad = noise.fbm(p.x / (scale * 0.9), p.y / (scale * 0.9), 3);
        let medium = noise.fbm(p.x / (scale * 0.32) + 17.0, p.y / (scale * 0.32) - 11.0, 2);
        let fine = noise.noise(p.x / (scale * 0.12) - 7.0, p.y / (scale * 0.12) + 23.0);
        let variation =
            (cfg.footprint.irregularity.sqrt() * 0.8 * (2.0 * broad + medium + 0.25 * fine)).exp();
        let terrain = 1.0
            + (0.35 + cfg.footprint.anisotropy * 0.65)
                * (grade * 2.5 + (grade / grade_limit).powi(2) * 4.0);
        let local_reach = centers
            .iter()
            .map(|c| distance(p, c.point))
            .fold(f64::INFINITY, f64::min)
            / reach;
        // A soft terminal cost, outside the ordinary target, prevents a scarce
        // valley budget from filling the rectangular calculation window.
        let terminal = 1.0 + 18.0 * ((local_reach - 0.72) / 0.28).max(0.0).powi(4);
        let resource = 1.0
            - (0.2 + water_affinity * 0.8).min(0.7)
                * (-shore.distances[i] / (radius * 0.6).max(20.0)).exp();
        costs[i] = attraction * branches * resource * variation * terrain * terminal;
        if porous {
            // A small satellite protects a smaller core than the main town;
            // overlapping full-size core exemptions would erase its gaps.
            let core_distance = centers
                .iter()
                .map(|c| distance(p, c.point) / (c.weight / strongest).sqrt().max(0.2))
                .fold(f64::INFINITY, f64::min);
            occupied[i] = sparse::occupied(
                cfg,
                &open_space,
                p,
                radius,
                step,
                core_distance,
                grade / grade_limit,
            );
        }
        if family == "fan" {
            let c = centers[0].point;
            let q = rotate(
                Point {
                    x: p.x - c.x,
                    y: p.y - c.y,
                },
                -angle,
            );
            if q.x < -radius * 0.12 || q.y.abs() > q.x.max(radius * 0.15) * 1.2 {
                dry_mask[i] = false;
            }
        }
        if let Some(f) = flood
            && dry_mask[i]
        {
            let s = terrain::block_slope(surface, p, f.gate.reach);
            housable[i] = s <= f.gate.limit;
            costs[i] *= f.gate.premium(s);
        }
    }
    if porous {
        sparse::resolve_gaps(&mut occupied, &dry_mask, &grid, cfg.footprint.gap_size);
    }
    // Water stays a barrier except along existing regional crossings: a town
    // spans its river through the bridge, ford or causeway it was founded on,
    // and never invents one. Each crossing joins the nearest buildable cells of
    // its two ends; the span costs more than the same length of open land, so
    // the far bank receives a bridgehead quarter rather than an equal share.
    let mut crossings: Vec<Vec<(usize, f64, usize)>> = vec![vec![]; n];
    let landing = |p: Point| {
        if p.x < grid.x0 || p.y < grid.y0 {
            return None;
        }
        let (cx, cy) = ((p.x - grid.x0) / step, (p.y - grid.y0) / step);
        if cx >= grid.nx as f64 + 2.0 || cy >= grid.ny as f64 + 2.0 {
            return None;
        }
        let (cx, cy) = (cx.floor() as isize, cy.floor() as isize);
        (cy - 3..=cy + 3)
            .flat_map(|y| (cx - 3..=cx + 3).map(move |x| (x, y)))
            .filter(|&(x, y)| x >= 0 && y >= 0 && x < grid.nx as isize && y < grid.ny as isize)
            .map(|(x, y)| y as usize * grid.nx + x as usize)
            .filter(|&i| dry_mask[i] && distance(grid.point(i), p) <= step * 3.0)
            .min_by(|&a, &b| distance(grid.point(a), p).total_cmp(&distance(grid.point(b), p)))
    };
    for road in roads {
        let penalty = match road.role.as_str() {
            "bridge" => 2.5,
            "causeway" => 3.0,
            "ford" => 4.0,
            _ => continue,
        };
        let (Some(&a), Some(&b)) = (road.path.first(), road.path.last()) else {
            continue;
        };
        let (Some(i), Some(j)) = (landing(a), landing(b)) else {
            continue;
        };
        if i == j {
            continue;
        }
        let span = road
            .path
            .windows(2)
            .map(|w| distance(w[0], w[1]))
            .sum::<f64>()
            + distance(grid.point(i), a)
            + distance(grid.point(j), b);
        crossings[i].push((j, span * penalty, usize::MAX));
        crossings[j].push((i, span * penalty, usize::MAX));
    }
    // Where no regional crossing serves a bank, the town may build its own
    // over water narrower than its builders' span, at the narrow points.
    let fixed = roads
        .iter()
        .filter(|r| matches!(r.role.as_str(), "bridge" | "ford" | "causeway"))
        .filter_map(|r| Some((*r.path.first()?, *r.path.last()?)))
        .collect::<Vec<_>>();
    // Automatic watercourse bridges must not close a sea harbour. Imported
    // regional crossings keep their own evidence and are preserved above.
    let urban:Vec<_> = crossings::candidates(&grid, &dry_mask, surface, &service.crossing, &fixed)
        .into_iter().filter(|c|!macroplan::harbour::port_town(cfg) || !macroplan::harbour::crosses_sea(surface,c.entry,c.exit)).collect();
    for (id, c) in urban.iter().enumerate() {
        let cost = c.cost(&grid);
        crossings[c.from].push((c.to, cost, id));
        crossings[c.to].push((c.from, cost, id));
    }
    let mut via = vec![usize::MAX; n];
    let mut bridged = vec![false; n];
    let mut arrivals = vec![f64::INFINITY; n];
    let mut parents = vec![usize::MAX; n];
    let mut heap = BinaryHeap::new();
    // A terrace nucleus needs usable land around it. The nearest dry cell can
    // be a one-cell ledge enclosed by cliffs, even beside a broad buildable
    // flank. Label physical components only for slope-adapted growth; ordinary
    // sites retain their exact seed and arithmetic.
    let mut components = vec![usize::MAX; n];
    let mut component_sizes = vec![];
    if capacity_seed {
        for root in 0..n {
            if !dry_mask[root] || components[root] != usize::MAX { continue; }
            let id = component_sizes.len();
            components[root] = id;
            let mut queue = vec![root];
            let mut cursor = 0;
            while cursor < queue.len() {
                let i = queue[cursor];
                cursor += 1;
                let (x, y) = (i % grid.nx, i / grid.nx);
                for (dx, dy) in [(1isize, 0isize), (-1, 0), (0, 1), (0, -1)] {
                    let (nx, ny) = (x as isize + dx, y as isize + dy);
                    if nx < 0 || ny < 0 || nx >= grid.nx as isize || ny >= grid.ny as isize { continue; }
                    let j = ny as usize * grid.nx + nx as usize;
                    if dry_mask[j] && components[j] == usize::MAX
                        && routing::segment_clear(surface, grid.point(i), grid.point(j), service.grade) {
                        components[j] = id;
                        queue.push(j);
                    }
                }
            }
            component_sizes.push(queue.len());
        }
    }
    let mut active_centers = vec![];
    for c in centers.iter_mut() {
        let nominal = grid.nearest(c.point);
        if fixed_center && c.id == 0 && !surface.wet(c.point) && neighbours.is_none_or(|m| !m.blocked(c.point)) {
            let (gx, gy) = slope(surface, c.point);
            if gx.hypot(gy) <= grade_limit {
                dry_mask[nominal] = true;
                heights[nominal] = surface.height_at(c.point);
            }
        }
        let candidates = || (0..n).filter(|&i| dry_mask[i]);
        let needed = if capacity_seed && !fixed_center {
            let available = candidates()
                .filter(|&i| distance(grid.point(i), c.point) < radius * 0.7)
                .map(|i| component_sizes[components[i]]).max().unwrap_or(0);
            available.min((target * 0.25 / step.powi(2)).ceil() as usize)
        } else { 0 };
        let seed = candidates()
            .filter(|&i| (!fixed_center || c.id != 0 || i == nominal)
                && (!capacity_seed || fixed_center || component_sizes[components[i]] >= needed))
            .min_by(|&a, &b| {
                distance(grid.point(a), c.point).total_cmp(&distance(grid.point(b), c.point))
            });
        if let Some(i) =
            seed.filter(|&i| distance(grid.point(i), grid.point(nominal)) < radius * 0.7)
        {
            if c.id != 0 || !fixed_center {
                c.point = grid.point(i);
            }
            active_centers.push(c.id);
            occupied[i] = true;
            if arrivals[i] > 0.0 {
                let cost = if porous {
                    (1.0 - c.weight / strongest) * radius * 0.8
                } else {
                    0.0
                };
                arrivals[i] = cost;
                heap.push(Arrival { cost, cell: i });
            }
        }
    }
    centers.retain(|c| active_centers.contains(&c.id));
    for (i, c) in centers.iter_mut().enumerate() {
        c.id = i;
    }
    let dirs: [(isize, isize); 16] = [
        (1, 0),
        (2, 1),
        (1, 1),
        (1, 2),
        (0, 1),
        (-1, 2),
        (-1, 1),
        (-2, 1),
        (-1, 0),
        (-2, -1),
        (-1, -1),
        (-1, -2),
        (0, -1),
        (1, -2),
        (1, -1),
        (2, -1),
    ];
    let mut order = vec![];
    let mut finalized = vec![false; n];
    let mut selected = vec![false; n];
    let budget = (target / step.powi(2)).ceil() as usize;
    // Faubourgs: once the walled (or older) epochs are complete, the last
    // epoch restarts from the whole town with a cost that rises away from the
    // approach roads, so it grows as ribbons out of the gates.
    let suburb_start = match (service.suburb_band, fractions.len()) {
        (band, epochs) if band > 0.0 && epochs >= 2 => {
            (budget as f64 * fractions[epochs - 2]).ceil() as usize
        }
        _ => usize::MAX,
    };
    let mut suburban = false;
    // Housable land gathered (m²) and whether it reached the flood's goal.
    let mut gathered = 0.0;
    let mut housed = false;
    while let Some(Arrival { cost, cell }) = heap.pop() {
        if cost > arrivals[cell] + 1e-9 || finalized[cell] {
            continue;
        }
        finalized[cell] = true;
        let connection = if parents[cell] == usize::MAX || bridged[cell] {
            vec![cell]
        } else {
            grid.move_cells(parents[cell], cell, &costs)
        };
        for i in connection {
            if !selected[i] && occupied[i] {
                selected[i] = true;
                order.push(i);
                if housable[i] {
                    gathered += step * step;
                }
            }
        }
        if let Some(f) = flood
            && gathered >= f.goal
        {
            housed = true;
            break;
        }
        if order.len() >= budget {
            break;
        }
        if !suburban && order.len() >= suburb_start {
            suburban = true;
            let band = service.suburb_band;
            for i in 0..n {
                costs[i] *= 1.0 + 8.0 * ((road_distance[i] - band) / band).clamp(0.0, 1.0);
                finalized[i] = false;
                arrivals[i] = if selected[i] { 0.0 } else { f64::INFINITY };
            }
            heap.clear();
            heap.extend(order.iter().map(|&cell| Arrival { cost: 0.0, cell }));
            continue;
        }
        let (x, y) = (cell % grid.nx, cell / grid.nx);
        for (dx, dy) in dirs {
            let (nx, ny) = (x as isize + dx, y as isize + dy);
            if nx < 0 || ny < 0 || nx >= grid.nx as isize || ny >= grid.ny as isize {
                continue;
            }
            let next = ny as usize * grid.nx + nx as usize;
            if !dry_mask[next] {
                continue;
            }
            // Four-connected land is authoritative; a diagonal cannot slip
            // between touching water corners and join two separate dry masses.
            if dx.abs() <= 1
                && dy.abs() <= 1
                && dx != 0
                && dy != 0
                && (!dry_mask[y * grid.nx + nx as usize] || !dry_mask[ny as usize * grid.nx + x])
            {
                continue;
            }
            let p = grid.point(cell);
            let q = grid.point(next);
            // Land is urban only if a street can reach it: every growth move
            // must be passable at street grade (stair grade only where the
            // culture builds stairs), so a slope is climbed by switchbacks
            // along the contours or not at all.
            if !routing::segment_clear(surface, p, q, service.grade) {
                continue;
            }
            let samples = dx.abs().max(dy.abs()) * 2;
            if (1..samples).any(|j| {
                let t = j as f64 / samples as f64;
                !dry_mask[grid.nearest(Point {
                    x: p.x + (q.x - p.x) * t,
                    y: p.y + (q.y - p.y) * t,
                })]
            }) {
                continue;
            }
            let v = rotate(
                Point {
                    x: dx as f64,
                    y: dy as f64,
                },
                -angle,
            );
            let stretch = if matches!(family, "elongated" | "linear") {
                ((v.x / aspect.sqrt()).powi(2) + (v.y * aspect.sqrt()).powi(2)).sqrt()
            } else {
                (dx as f64).hypot(dy as f64)
            };
            let grade =
                (heights[next] - heights[cell]).abs() / (step * (dx as f64).hypot(dy as f64));
            let terrain =
                1.0 + cfg.footprint.anisotropy * (grade * 6.0 + grade.powi(2) * 35.0).min(15.0);
            let quadrature = dx.abs().max(dy.abs()) * 4;
            let local_cost = (0..quadrature)
                .map(|j| {
                    let t = (j as f64 + 0.5) / quadrature as f64;
                    costs[grid.nearest(Point {
                        x: p.x + (q.x - p.x) * t,
                        y: p.y + (q.y - p.y) * t,
                    })]
                })
                .sum::<f64>()
                / quadrature as f64;
            let next_cost = cost + step * stretch * terrain * local_cost;
            if next_cost + 1e-9 < arrivals[next] {
                arrivals[next] = next_cost;
                parents[next] = cell;
                bridged[next] = false;
                via[next] = usize::MAX;
                heap.push(Arrival {
                    cost: next_cost,
                    cell: next,
                });
            }
        }
        for &(next, span, id) in &crossings[cell] {
            let next_cost = cost + span * costs[next];
            if !finalized[next] && next_cost + 1e-9 < arrivals[next] {
                arrivals[next] = next_cost;
                parents[next] = cell;
                bridged[next] = true;
                via[next] = id;
                heap.push(Arrival {
                    cost: next_cost,
                    cell: next,
                });
            }
        }
    }
    // A bank reached only over a crossing has no centre of its own yet.
    let landings = (0..n)
        .filter(|&i| bridged[i] && selected[i])
        .map(|i| grid.point(i))
        .collect::<Vec<_>>();
    let reserve = vec![g::rectangle(x0, y0, x1, y1)];
    let land = |mask: &[bool]| {
        dry(surface, &grid.contours(mask))
            .into_iter()
            .filter(|s| {
                porous
                    || centers.iter().any(|c| g::contains(s, c.point))
                    || landings.iter().any(|&p| g::contains(s, p))
            })
            .collect::<Vec<_>>()
    };
    let mut final_mask = vec![false; n];
    for &i in &order {
        final_mask[i] = true;
    }
    let fill = (service.min_gap / step.powi(2)).ceil() as usize;
    fill_holes(&mut final_mask, &grid, fill);
    let mut anchors = grid.boundary_centers(&final_mask);
    anchors.extend(centers.iter().map(|c| c.point));
    let final_land = smooth_growth(&land(&final_mask), step, surface, &anchors);
    let mut phases = vec![];
    let mut previous: Vec<Shape> = vec![];
    let epochs = fractions.len();
    for (epoch, &fraction) in fractions.iter().enumerate() {
        let take = ((order.len() as f64 * fraction).round() as usize).min(order.len());
        let mut mask = vec![false; n];
        for &i in &order[..take] {
            mask[i] = true;
        }
        fill_holes(&mut mask, &grid, fill);
        let grown = if epoch + 1 == epochs {
            final_land.clone()
        } else {
            let mut anchors = grid.boundary_centers(&mask);
            anchors.extend(centers.iter().map(|c| c.point));
            let connected = smooth_growth(&land(&mask), step, surface, &anchors);
            // Pairs with disjoint boxes intersect in nothing: skip them.
            let final_boxes = final_land.iter().map(g::bbox).collect::<Vec<_>>();
            let clipped = connected
                .iter()
                .flat_map(|s| {
                    let a = g::bbox(s);
                    final_land.iter().zip(&final_boxes).flat_map(move |(f, b)| {
                        if a.2 < b.0 || b.2 < a.0 || a.3 < b.1 || b.3 < a.1 {
                            Vec::new()
                        } else {
                            g::intersection(s, f)
                        }
                    })
                })
                .collect::<Vec<_>>();
            union(&[previous.clone(), clipped].concat())
        };
        phases.push(subtract(&grown, &previous));
        previous = grown;
    }
    // A built crossing joins two selected banks; it becomes a street.
    let mut built = (0..n)
        .filter(|&i| selected[i] && via[i] != usize::MAX && selected[parents[i]])
        .map(|i| via[i])
        .collect::<Vec<_>>();
    built.sort_unstable();
    built.dedup();
    let streets = built
        .into_iter()
        .flat_map(|id| urban[id].streets(&grid, &service.crossing))
        .collect();
    // Measured on the cells taken: the land the town's blocks will stand on.
    let land = gate.and_then(|g| terrain::tally(surface, order.iter().map(|&i| grid.point(i)), g))
        .map(|survey| (survey, Taken { grid, cells: order }));
    (reserve, phases, streets, housed, land)
}
