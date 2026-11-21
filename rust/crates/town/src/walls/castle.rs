//! A castle on a strong point as founding focus (design 4.3, 5.3): its circuit on the hill's
//! contour, raised at once, its bailey outside the housing budget, and the castle road switching
//! back down to the regional road at lane grade. At each later precinct survey the town wall
//! either joins the castle circuit at two nodes (the castle chain becomes a fixed arc of the
//! precinct, the castle keeps a field gate) or stays apart, linked by the road.
//!
//! The bailey follows classic's `heights_castle` (`fortification_heights.rs`): rays from the
//! summit stop where the ground falls below it by a share of the knoll's rise, within 0.6 to 1.5
//! bailey radii, smoothed and fitted as a village circuit.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::f64::consts::{PI, TAU};

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::geometry::{add, dist, lerp};
use super::growth_regime::FIELD_GATE_SLOT;
use super::insert::{Stroke, insert_loop, insert_to_edge, on_ring, seat_nodes};
use super::precinct::{Gate, Precinct, Purpose, Route, curtain_width};
use super::{TraceFamily, village_trace};
use crate::graph::{Clock, EdgeClass, FaceKind, Key, Level, NodeKind, tag};
use crate::journal::{EventKind, Op, Stage};
use crate::spec::{PrecinctSpec, WallKind};
use crate::survey::{StrongPoint, Survey};

/// Node slot of the castle gate towards the road.
const GATE_SLOT: u32 = 5;
/// Steps of a castle road on its search grid: the 16 directions of a two-cell neighbourhood, so
/// that a road can climb at lane grade across contours at many angles.
const MOVES: [(i64, i64); 16] = [
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
/// A town line within this many bailey radii of the castle may join it.
const JOIN_REACH: f64 = 1.2;
/// Steepest grade the ground between a town line and a castle may have for them to join.
const JOIN_GRADE: f64 = 0.5;
/// Width in metres of a castle road.
const ROAD_WIDTH: f64 = 4.0;

/// A founding castle.
#[derive(Clone, Debug)]
pub struct Castle {
    /// Its circuit as a precinct record, raised at founding.
    pub precinct: Precinct,
    /// Key of its circuit chain.
    pub chain: Key,
    /// Its closed circuit, counter-clockwise.
    pub outline: Shape,
    /// The castle gate the road leaves from.
    pub gate: Key,
    pub gate_position: Point,
    /// Chain of the castle road, when drawn.
    pub road: Option<Key>,
    /// The first buildable shelf below the gate along the road: where the founding quarter opens.
    pub foot: Point,
}

/// The key the castle's edges and nodes hang from: a child of the founding event's key, apart
/// from the regional roads it also draws.
pub fn castle_key() -> Key {
    EventKind::Found {
        center: Point::default(),
        focus: String::new(),
    }
    .key()
    .child(tag::SUBJECT, &[1])
}

/// Bailey area in square metres for a town of `inhabitants`: classic's 0.35 ha for a small town
/// up to 2.2 ha for a capital.
pub fn bailey_area(inhabitants: f64) -> f64 {
    (3500.0 + 0.3 * inhabitants).clamp(3500.0, 22_000.0)
}

/// The castle circuit on the contour of the strong point. `None` when the knoll cannot hold a
/// simple dry circuit of about the bailey's area.
pub fn castle_outline(
    terrain: &dyn TerrainView,
    point: &StrongPoint,
    inhabitants: f64,
) -> Option<Shape> {
    let want = bailey_area(inhabitants);
    let r = (want / PI).sqrt();
    let top = point.position;
    let h_top = terrain.height_at(top);
    let rise = (point.score - 1.5 * point.prominence).max(0.0);
    let drop = (0.45 * rise).clamp(3.0, 14.0);
    let mut radii: Vec<f64> = (0..32)
        .map(|k| {
            let a = f64::from(k) * TAU / 32.0;
            let u = (a.cos(), a.sin());
            let mut d = 0.0;
            while d < 1.5 * r {
                let q = add(top, u, d + 3.0);
                if terrain.wet(q) || terrain.height_at(q) < h_top - drop {
                    break;
                }
                d += 3.0;
            }
            d.clamp(0.6 * r, 1.5 * r)
        })
        .collect();
    for _ in 0..2 {
        let n = radii.len();
        radii = (0..n)
            .map(|k| 0.25 * radii[(k + n - 1) % n] + 0.5 * radii[k] + 0.25 * radii[(k + 1) % n])
            .collect();
    }
    let outer: Vec<Point> = radii
        .iter()
        .enumerate()
        .map(|(k, &d)| {
            let a = k as f64 * TAU / 32.0;
            add(top, (a.cos(), a.sin()), d)
        })
        .collect();
    let cell = terrain.width() / terrain.water_resolution().max(1) as f64;
    let castle = village_trace(
        &g::normalized(Shape {
            outer,
            holes: vec![],
        }),
        cell.max(8.0),
        true,
    );
    let area = g::area(&castle);
    let dry: f64 = terrain.dry_clip(&castle).iter().map(g::area).sum();
    (castle.outer.len() >= 3
        && g::simple(&castle)
        && (0.35 * want..=2.6 * want).contains(&area)
        && dry >= 0.97 * area)
        .then(|| g::normalized(castle))
}

/// Draw the castle on the founding stage: the circuit as a wall, its interior a bailey, the
/// castle gate on the side facing the nearest of `roads`, and the castle road from the gate down
/// to that road at `lane_grade`. Returns the castle and its warnings; `None` when the circuit
/// cannot be drawn.
#[allow(clippy::too_many_arguments)]
pub fn found_castle(
    stage: &mut Stage,
    survey: &Survey,
    terrain: &dyn TerrainView,
    point: &StrongPoint,
    inhabitants: f64,
    roads: &[Vec<Point>],
    lane_grade: f64,
    spec: &PrecinctSpec,
) -> Option<(Castle, Vec<String>)> {
    let mut warnings = Vec::new();
    let outline = castle_outline(terrain, point, inhabitants)?;
    let event = castle_key();
    let kind = Some(WallKind::Wall);
    let curtain = curtain_width(kind);
    let mut rank = 0;
    let line = insert_loop(
        stage,
        &event,
        &mut rank,
        &outline.outer,
        Stroke {
            class: EdgeClass::Wall,
            rank: 0,
            width: curtain,
        },
    )?;
    let inside = g::interior_point(&outline);
    let bailey = stage.graph().face_at(Level::Ground, inside);
    if bailey != stage.graph().outside(Level::Ground) {
        let face = stage.graph().face(bailey).key.clone();
        let _ = stage.try_push(vec![Op::SetFaceKind {
            face,
            kind: FaceKind::Bailey,
        }]);
    }
    let target = nearest_road(roads, inside);
    let gate_at = outline
        .outer
        .iter()
        .copied()
        .min_by(|a, b| {
            dist(*a, target.unwrap_or(inside))
                .total_cmp(&dist(*b, target.unwrap_or(inside)))
                .then(a.x.total_cmp(&b.x))
        })
        .unwrap_or(outline.outer[0]);
    let seated = seat_nodes(
        stage,
        &line.chain,
        &[gate_at],
        NodeKind::CastleGate,
        &event,
        GATE_SLOT,
    );
    let (gate, gate_position) = seated.into_iter().next()?;
    let path = castle_road(
        terrain,
        survey,
        gate_position,
        &outline,
        roads,
        lane_grade,
        spec.castle_road_reach,
    );
    let mut road = None;
    let mut foot = gate_position;
    match path {
        Some(path) => {
            let stroke = Stroke {
                class: EdgeClass::CastleRoad,
                rank: 1,
                width: ROAD_WIDTH,
            };
            foot = shelf(survey, &path, &outline, lane_grade).unwrap_or(path[path.len() - 1]);
            match insert_to_edge(
                stage,
                &event,
                &mut rank,
                &path,
                &gate,
                |c| c == EdgeClass::RegionalRoad,
                stroke,
            ) {
                Some(drawn) => road = Some(drawn.chain),
                None => warnings.push("Castle road not drawn (Route du château non tracée)".into()),
            }
        }
        None => warnings.push("No castle road at lane grade (Pas de route du château)".into()),
    }
    let precinct = Precinct {
        index: 0,
        purpose: Purpose::Castle,
        chain: line.chain.clone(),
        wall_street: None,
        outline: outline.clone(),
        enclosed: outline.clone(),
        land: outline.clone(),
        gates: vec![Gate {
            node: gate.clone(),
            position: gate_position,
            route: Some(Route::Castle),
            kind: NodeKind::CastleGate,
        }],
        terminals: vec![],
        family: TraceFamily::Hill,
        style: "castle".into(),
        kind,
        curtain_width: curtain,
        corners: vec![],
        salients: vec![],
        shared: vec![],
        attached_to: None,
        joins_castle: false,
        surveyed: Clock::ZERO,
        sized_for: 0.0,
        raised: Some(Clock::ZERO),
    };
    Some((
        Castle {
            precinct,
            chain: line.chain,
            outline,
            gate,
            gate_position,
            road,
            foot,
        },
        warnings,
    ))
}

/// The point of the nearest road to `p`.
fn nearest_road(roads: &[Vec<Point>], p: Point) -> Option<Point> {
    roads
        .iter()
        .flat_map(|r| r.windows(2))
        .map(|w| g::distance(p, w[0], w[1]))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, _, q)| q)
}

/// The first point along `path`, outside the castle, whose ground is no steeper than half the
/// lane grade: the first buildable shelf below the gate.
fn shelf(survey: &Survey, path: &[Point], castle: &Shape, lane_grade: f64) -> Option<Point> {
    path.iter().copied().find(|&p| {
        !g::contains(castle, p)
            && survey
                .cell_at(p)
                .is_some_and(|c| !c.closed && c.slope <= lane_grade * 0.5)
    })
}

#[derive(Clone, Copy, PartialEq)]
struct Visit {
    cost: f64,
    cell: usize,
}

impl Eq for Visit {}

impl Ord for Visit {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then(other.cell.cmp(&self.cell))
    }
}

impl PartialOrd for Visit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// The least-cost way from `from` (on the castle circuit) to the nearest of `roads` within
/// `reach`, never steeper than `lane_grade` on any step, so that on a steep flank it switches
/// back. A step costs its length times `1 + 4 (grade / lane_grade)²`; closed land and the
/// castle's own ground are refused. `None` when no road is in reach at that grade.
pub fn castle_road(
    terrain: &dyn TerrainView,
    survey: &Survey,
    from: Point,
    castle: &Shape,
    roads: &[Vec<Point>],
    lane_grade: f64,
    reach: f64,
) -> Option<Vec<Point>> {
    let step = survey.cell_size();
    let half = (reach / step).ceil() as i64;
    let side = 2 * half + 1;
    let at = |c: usize| {
        let (i, j) = ((c as i64 % side) - half, (c as i64 / side) - half);
        Point {
            x: from.x + i as f64 * step,
            y: from.y + j as f64 * step,
        }
    };
    let count = (side * side) as usize;
    let mut height = vec![f64::NAN; count];
    let mut cost = vec![f64::INFINITY; count];
    let mut back = vec![usize::MAX; count];
    let start = (half * side + half) as usize;
    let on_road = |p: Point| {
        roads.iter().any(|r| {
            r.windows(2)
                .any(|w| g::distance(p, w[0], w[1]).0 <= step * 0.75)
        })
    };
    let mut queue = BinaryHeap::new();
    cost[start] = 0.0;
    queue.push(Visit {
        cost: 0.0,
        cell: start,
    });
    let mut reached = None;
    while let Some(Visit { cost: c, cell }) = queue.pop() {
        if c > cost[cell] {
            continue;
        }
        let p = at(cell);
        if cell != start && on_road(p) {
            reached = Some(cell);
            break;
        }
        if height[cell].is_nan() {
            height[cell] = terrain.height_at(p);
        }
        let (ci, cj) = (cell as i64 % side, cell as i64 / side);
        for (di, dj) in MOVES {
            let (ni, nj) = (ci + di, cj + dj);
            if ni < 0 || nj < 0 || ni >= side || nj >= side {
                continue;
            }
            let next = (nj * side + ni) as usize;
            let q = at(next);
            if q.distance(from) > reach {
                continue;
            }
            if g::contains(castle, q) || survey.closed_at(q) || terrain.wet(q) {
                continue;
            }
            if height[next].is_nan() {
                height[next] = terrain.height_at(q);
            }
            let length = (di as f64).hypot(dj as f64) * step;
            let grade = (height[next] - height[cell]).abs() / length;
            if !(grade <= lane_grade) {
                continue;
            }
            let total = c + length * (1.0 + 4.0 * (grade / lane_grade.max(1e-6)).powi(2));
            if total < cost[next] {
                cost[next] = total;
                back[next] = cell;
                queue.push(Visit {
                    cost: total,
                    cell: next,
                });
            }
        }
    }
    let mut cell = reached?;
    let mut path = vec![at(cell)];
    while back[cell] != usize::MAX {
        cell = back[cell];
        path.push(at(cell));
    }
    path.reverse();
    path[0] = from;
    // The first steps stay as found, so that the road leaves the gate clear of the curtain.
    Some(g::simplify(&path, 1.0, |p| p.distance(from) < 3.0 * step))
}

/// Whether a town line joins the castle circuit: it reaches within `JOIN_REACH` bailey radii of
/// it, and the ground between their nearest points is open and no steeper than `JOIN_GRADE`.
pub fn joins(survey: &Survey, terrain: &dyn TerrainView, town: &Shape, castle: &Castle) -> bool {
    let r = (g::area(&castle.outline) / PI).sqrt();
    let Some((a, b)) = nearest_pair(&town.outer, &castle.outline.outer) else {
        return false;
    };
    let gap = dist(a, b);
    if g::intersection(town, &castle.outline)
        .iter()
        .map(g::area)
        .sum::<f64>()
        > 1.0
    {
        return true;
    }
    if gap > JOIN_REACH * r {
        return false;
    }
    let k = (gap / survey.cell_size()).ceil().max(1.0) as usize;
    (0..=k).all(|i| {
        let p = lerp(a, b, i as f64 / k as f64);
        g::contains(&castle.outline, p) || !survey.closed_at(p)
    }) && (terrain.height_at(a) - terrain.height_at(b)).abs() <= JOIN_GRADE * gap.max(1.0)
}

/// The town line run round the castle: one simple outline holding both, whose ring follows the
/// castle circuit on a stretch. `None` when they do not make one such outline.
pub fn wrap(town: &Shape, castle: &Castle) -> Option<Shape> {
    let hull = if g::intersection(town, &castle.outline)
        .iter()
        .map(g::area)
        .sum::<f64>()
        > 1.0
    {
        g::union(&[town.clone(), castle.outline.clone()])
    } else {
        // Apart but close: bridge the gap with the quadrilateral between their nearest sides.
        let (a, b) = nearest_pair(&town.outer, &castle.outline.outer)?;
        let (u, v) = ((b.x - a.x, b.y - a.y), (a.y - b.y, b.x - a.x));
        let l = v.0.hypot(v.1).max(1e-9);
        let w = 12.0;
        let n = (v.0 / l * w, v.1 / l * w);
        let bridge = g::normalized(Shape {
            outer: vec![
                Point {
                    x: a.x - n.0 - u.0 * 0.1,
                    y: a.y - n.1 - u.1 * 0.1,
                },
                Point {
                    x: b.x - n.0 + u.0 * 0.1,
                    y: b.y - n.1 + u.1 * 0.1,
                },
                Point {
                    x: b.x + n.0 + u.0 * 0.1,
                    y: b.y + n.1 + u.1 * 0.1,
                },
                Point {
                    x: a.x + n.0 - u.0 * 0.1,
                    y: a.y + n.1 - u.1 * 0.1,
                },
            ],
            holes: vec![],
        });
        g::union(&[town.clone(), bridge, castle.outline.clone()])
    };
    match hull.as_slice() {
        [one] if one.holes.is_empty() && g::simple(one) => {
            let on = one
                .outer
                .iter()
                .filter(|&&p| on_ring(&castle.outline, p))
                .count();
            (on >= 2).then(|| g::normalized(one.clone()))
        }
        _ => None,
    }
}

/// The castle's field gate once a town precinct joins it: a castle gate on the stretch of its
/// circuit that stays on the town's outer line, at the vertex farthest from the town's centroid.
pub fn field_gate(stage: &mut Stage, castle: &Castle, town: &Shape) -> Option<Gate> {
    let centre = g::centroid(town);
    let at = castle
        .outline
        .outer
        .iter()
        .copied()
        .filter(|&p| on_ring(town, p) && dist(p, castle.gate_position) > 20.0)
        .max_by(|a, b| {
            dist(*a, centre)
                .total_cmp(&dist(*b, centre))
                .then(a.x.total_cmp(&b.x))
        })?;
    let (node, position) = seat_nodes(
        stage,
        &castle.chain,
        &[at],
        NodeKind::CastleGate,
        &castle_key(),
        FIELD_GATE_SLOT,
    )
    .into_iter()
    .next()?;
    Some(Gate {
        node,
        position,
        route: None,
        kind: NodeKind::CastleGate,
    })
}

/// The nearest pair of points between two closed rings, vertex to side both ways.
fn nearest_pair(a: &[Point], b: &[Point]) -> Option<(Point, Point)> {
    let one_way = |from: &[Point], to: &[Point]| {
        let m = to.len();
        from.iter()
            .flat_map(|&p| (0..m).map(move |i| (p, g::distance(p, to[i], to[(i + 1) % m]))))
            .min_by(|x, y| x.1.0.total_cmp(&y.1.0))
            .map(|(p, (d, _, q))| (d, p, q))
    };
    let x = one_way(a, b)?;
    let y = one_way(b, a)?;
    Some(if x.0 <= y.0 { (x.1, x.2) } else { (y.2, y.1) })
}
