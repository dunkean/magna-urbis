//! Quarter access relays and contour spines before subdivision.

use super::streets::{add, len};
use crate::rng::Rng;
use crate::urban::{
    Enclosure, GrowthPhase, LayoutConfig, Morph, Point, Quarter, Shape, Street, Surface,
    UrbanStructure, geometry as g, par, routing, warnings,
};

/// Distance from `p` to the nearest point of a street, and that point.
fn nearest_on(p: Point, st: &Street) -> Option<(f64, Point)> {
    st.path
        .windows(2)
        .map(|w| g::distance(p, w[0], w[1]))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(d, _, q)| (d, q))
}
/// Bounding box of an open polyline.
fn path_bbox(path: &[Point]) -> (f64, f64, f64, f64) {
    path.iter().fold(
        (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)),
    )
}
/// True when a street runs inside the quarter or along its edge (within 1 m).
pub(super) fn touches(q: &Shape, bb: (f64, f64, f64, f64), st: &Street) -> bool {
    let rings: Vec<&Vec<Point>> = std::iter::once(&q.outer).chain(&q.holes).collect();
    st.path.windows(2).any(|w| {
        let (a, b) = (w[0], w[1]);
        if a.x.max(b.x) < bb.0 - 1.0
            || a.x.min(b.x) > bb.2 + 1.0
            || a.y.max(b.y) < bb.1 - 1.0
            || a.y.min(b.y) > bb.3 + 1.0
        {
            return false;
        }
        g::contains(q, a)
            || g::contains(q, b)
            || rings.iter().any(|r| {
                r.iter().zip(r.iter().cycle().skip(1)).any(|(&c, &d)| {
                    g::segment_hit(a, b, c, d).is_some()
                        || g::distance(a, c, d).0 <= 1.0
                        || g::distance(b, c, d).0 <= 1.0
                        || g::distance(c, a, b).0 <= 1.0
                })
            })
    })
}

/// Street service of the quarter partition, enforced before any subdivision:
/// a sliver smaller than a block joins its neighbour, every quarter touches a
/// street, and a quarter no street can reach at street grade (lane, then
/// stairs only where the culture builds them) is returned to open land and
/// counted as shortfall rather than parcelled into streetless strips.
#[allow(clippy::too_many_arguments)]
pub(super) fn serve_quarters(
    quarters: &mut Vec<Quarter>,
    streets: &mut Vec<Street>,
    enclosures: &[Enclosure],
    phases: &mut [GrowthPhase],
    structure: Option<&mut UrbanStructure>,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    rng: &mut Rng,
) -> Option<String> {
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    #[cfg(target_arch = "wasm32")]
    let lap = |_: &str| {};
    #[cfg(not(target_arch = "wasm32"))]
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!(
                "    serve.{label}: {:.0} ms",
                tick.elapsed().as_secs_f64() * 1000.0
            );
        }
    };
    let sliver = m.number("minBlock").max(150.0);
    let mut i = 0;
    while i < quarters.len() {
        if g::area(&quarters[i].shape) >= sliver || quarters.len() == 1 {
            i += 1;
            continue;
        }
        let q = quarters.remove(i);
        let bb = g::bbox(&q.shape);
        let mut neighbours: Vec<usize> = (0..quarters.len())
            .filter(|&j| {
                let o = g::bbox(&quarters[j].shape);
                o.0 <= bb.2 + 0.5 && bb.0 <= o.2 + 0.5 && o.1 <= bb.3 + 0.5 && bb.1 <= o.3 + 0.5
            })
            .collect();
        neighbours.sort_by_key(|&j| quarters[j].phase != q.phase);
        for j in neighbours {
            let merged = g::union(&[quarters[j].shape.clone(), q.shape.clone()]);
            if merged.len() == 1 {
                quarters[j].shape = merged.into_iter().next().unwrap();
                break;
            }
        }
        // A sliver without a neighbour stays open land.
    }
    let walls: Vec<Shape> = enclosures
        .iter()
        .map(|e| {
            let mut outer = e.path.clone();
            if outer.len() > 3 && outer.first() == outer.last() {
                outer.pop();
            }
            g::normalized(Shape {
                outer,
                holes: vec![],
            })
        })
        .collect();
    let gates: Vec<Point> = enclosures.iter().flat_map(|e| e.gates.clone()).collect();
    let inside = |p: Point| walls.iter().filter(|w| g::contains(w, p)).count();
    let crosses_wall = |path: &[Point]| {
        path.windows(2).any(|w| {
            enclosures.iter().any(|e| {
                e.path.windows(2).any(|s| {
                    g::segment_hit(w[0], w[1], s[0], s[1]).is_some_and(|(_, x)| {
                        !gates.iter().any(|gt| (gt.x - x.x).hypot(gt.y - x.y) < 15.0)
                    })
                })
            })
        })
    };
    let (mut dropped, mut lost) = (vec![], 0.0);
    let mut kept = Vec::with_capacity(quarters.len());
    lap("slivers");
    let first_feeder = streets.len();
    // A street whose whole box misses the quarter's (1 m slack, as in
    // `touches`) has no segment near it: skip it without walking its path.
    let street_boxes: Vec<_> = streets.iter().map(|s| path_bbox(&s.path)).collect();
    let touched = par::map(quarters, |_, q| {
        let bb = g::bbox(&q.shape);
        streets.iter().zip(&street_boxes).any(|(st, sb)| {
            sb.0 <= bb.2 + 1.0
                && sb.2 >= bb.0 - 1.0
                && sb.1 <= bb.3 + 1.0
                && sb.3 >= bb.1 - 1.0
                && touches(&q.shape, bb, st)
        })
    });
    lap("touched");
    // Nearest street points of the street network `net` reachable from the
    // quarter's interior without changing enclosure side, nearest first.
    let targets_from = |start: Point, side: usize, net: &[Street]| {
        let mut targets: Vec<(f64, Point)> = net
            .iter()
            .filter_map(|st| nearest_on(start, st))
            .filter(|&(_, p)| inside(p) == side)
            .collect();
        targets.sort_by(|a, b| a.0.total_cmp(&b.0));
        targets
    };
    // A plan without a single street (a lone quarter on a cramped site) is
    // fed from the regional roads rather than returned to the countryside.
    let targets_or_roads = |start: Point, side: usize, net: &[Street]| {
        let t = targets_from(start, side, net);
        if t.is_empty() { targets_from(start, side, roads) } else { t }
    };
    // Feeder route from `start` to the first reachable of the 4 nearest
    // targets: street grade, then lane, then stairs where allowed.
    let route_feeder = |start: Point, targets: &[(f64, Point)]| {
        for &(d, target) in targets.iter().take(4) {
            let margin = d.max(40.0) * 0.5 + 40.0;
            let mut planner = routing::RoutePlanner::new(
                surface,
                (
                    start.x.min(target.x) - margin,
                    start.y.min(target.y) - margin,
                    start.x.max(target.x) + margin,
                    start.y.max(target.y) + margin,
                ),
            );
            for (grade, role, rank) in [
                (cfg.max_street_grade, "street", 2),
                (cfg.max_lane_grade, "lane", 3),
                (cfg.max_stair_grade, "stairs", 3),
            ] {
                if role == "stairs" && !cfg.allow_stairs {
                    break;
                }
                if let Some(path) = planner
                    .route(target, start, grade)
                    .filter(|p| !crosses_wall(p))
                {
                    return Some((path, role, rank));
                }
            }
        }
        None
    };
    // Routes are planned in parallel against the network before any feeder;
    // the serial pass below keeps a plan only while no earlier feeder enters
    // the quarter's four nearest targets (otherwise it replans exactly as a
    // serial pass would), so the result does not depend on the threads.
    let unserved: Vec<usize> = (0..quarters.len()).filter(|&i| !touched[i]).collect();
    let mut planned: std::collections::HashMap<usize, _> = unserved
        .iter()
        .copied()
        .zip(par::map(&unserved, |_, &i| {
            let start = g::interior_point(&quarters[i].shape);
            let side = inside(start);
            let targets = targets_or_roads(start, side, streets);
            let feeder = route_feeder(start, &targets);
            (start, side, targets, feeder)
        }))
        .collect();
    // A settlement none of whose quarters any street reaches (a place set on a
    // flank steeper than its feeders can climb) is not returned whole to the
    // countryside: its largest quarter is served by a level street along the
    // contour, the terrace a hill village strings its houses on.
    let rescue = (!touched.iter().any(|&t| t) && planned.values().all(|p| p.3.is_none()))
        .then(|| (0..quarters.len()).max_by(|&a, &b| g::area(&quarters[a].shape).total_cmp(&g::area(&quarters[b].shape))))
        .flatten();
    for (qi, (q, touched)) in quarters.drain(..).zip(touched).enumerate() {
        let bb = g::bbox(&q.shape);
        if touched
            || streets[first_feeder..]
                .iter()
                .any(|st| touches(&q.shape, bb, st))
        {
            kept.push(q);
            continue;
        }
        let (start, side, targets, plan) = planned.remove(&qi).expect("planned feeder");
        let cutoff = targets.get(3).map_or(f64::INFINITY, |t| t.0);
        let stale = streets[first_feeder..]
            .iter()
            .any(|st| nearest_on(start, st).is_some_and(|(d, p)| d <= cutoff && inside(p) == side));
        let feeder = if stale {
            route_feeder(start, &targets_or_roads(start, side, streets))
        } else {
            plan
        };
        let feeder = feeder.or_else(|| {
            (rescue == Some(qi)).then(|| contour_spine(&q.shape, start, surface)).flatten().map(|path| (path, "street", 2))
        });
        if let Some((path, role, rank)) = feeder {
            add(streets, path, rank, role, m, rng);
            kept.push(q);
        } else {
            lost += g::area(&q.shape);
            for phase in phases.iter_mut() {
                phase.shapes = phase
                    .shapes
                    .iter()
                    .flat_map(|s| g::difference(s, &q.shape))
                    .filter(|s| g::area(s) > 1.0)
                    .collect();
            }
            dropped.push(q.shape);
        }
    }
    *quarters = kept;
    lap("feeders");
    if dropped.is_empty() {
        return None;
    }
    if let Some(s) = structure {
        for q in &dropped {
            s.allocated = s
                .allocated
                .iter()
                .flat_map(|a| g::difference(a, q))
                .filter(|a| g::area(a) > 1.0)
                .collect();
        }
        s.metrics.allocated_area = (s.metrics.allocated_area - lost).max(0.0);
        s.metrics.shortfall_area += lost;
    }
    Some(warnings::unserved_quarters(dropped.len(), lost))
}

/// A level street through `start` that follows the contour across `shape`
/// both ways (on a cone it bends round the hill), sampled every 6 m and kept
/// every 18 m; `None` when it is shorter than 30 m.
fn contour_spine(shape: &Shape, start: Point, surface: Surface<'_>) -> Option<Vec<Point>> {
    const STEP: f64 = 6.0;
    let walk = |sign: f64| {
        let (mut p, mut heading, mut out) = (start, None::<Point>, vec![]);
        for _ in 0..400 {
            let r = 4.0;
            let gx = (surface.height_at(Point { x: p.x + r, y: p.y }) - surface.height_at(Point { x: p.x - r, y: p.y })) / (2.0 * r);
            let gy = (surface.height_at(Point { x: p.x, y: p.y + r }) - surface.height_at(Point { x: p.x, y: p.y - r })) / (2.0 * r);
            let n = gx.hypot(gy);
            let mut d = if n > 1e-6 { Point { x: -gy / n * sign, y: gx / n * sign } } else { heading.unwrap_or(Point { x: sign, y: 0.0 }) };
            if let Some(h) = heading && d.x * h.x + d.y * h.y < 0.0 {
                d = Point { x: -d.x, y: -d.y };
            }
            let q = Point { x: p.x + d.x * STEP, y: p.y + d.y * STEP };
            if !g::contains(shape, q) || surface.wet(q) {
                break;
            }
            out.push(q);
            (p, heading) = (q, Some(d));
        }
        out
    };
    let mut path: Vec<Point> = walk(-1.0).into_iter().rev().collect();
    path.push(start);
    path.extend(walk(1.0));
    let last = path.len() - 1;
    let path: Vec<Point> = path.into_iter().enumerate().filter(|&(i, _)| i % 3 == 0 || i == last).map(|(_, p)| p).collect();
    (len(&path) >= 30.0).then_some(path)
}
