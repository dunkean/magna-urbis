//! Main street chains: regional roads and the tissue's main axes.
//!
//! Regional roads enter whole at founding, clipped to the survey reach: they exist before the
//! town. The tissue's main axes start at the founding focus as classic's organic spines do
//! (`cultural_spines` in core's `urban/macroplan.rs`: diameters through the nucleus, the first
//! along the town's orientation, the others evenly turned from it (three, so that the town
//! radiates six main streets as classic's do), an arm that would double a regional road left
//! out and its opposite arm continuing the road). The growth engine traces them through the
//! street field with its skeleton (`growth/skeleton.rs`). Harbour and castle roads join the
//! founding chains.

mod boundary;
mod chain;
pub mod fate;

use std::collections::HashSet;
use std::f64::consts::PI;

use magna_urbis_geom::surface::TerrainView;
use magna_urbis_geom::{Point, distance};
use magna_urbis_random::Rng;

pub use boundary::{BoundaryArc, arcs, in_town};
pub use chain::{Draw, Hit, Meet, Tip, chain_ops, crossings};

use crate::graph::{EdgeClass, Graph, Key, Level, NodeId, NodeKind, tag};
use crate::journal::{Op, Stage};
use crate::spec::GrowthSpec;
use crate::survey::Survey;
use crate::tissue::organic::{FieldOrientation, OrganicParams};

/// A street end within this distance of the founding focus takes the focus (metres).
const FOCUS_JOIN: f64 = 15.0;
/// A regional road end within this distance of a node or edge joins it (metres).
const ROAD_JOIN: f64 = 1.0;
/// Classic's test for an arm that doubles a regional road: the cosine of the angle between them.
const ALONG_ROAD: f64 = 0.85;
/// Distance along a road at which its direction from the focus is read (metres).
const ROAD_SIGHT: f64 = 60.0;

/// One main axis from the founding focus.
#[derive(Clone, Debug, PartialEq)]
pub struct Arm {
    /// Key of the chain the axis is drawn as.
    pub chain: Key,
    /// Direction from the focus in radians.
    pub bearing: f64,
    /// Street rank: 0 for the first diameter, 1 for the others.
    pub rank: u8,
    /// Drawn width in metres.
    pub width: f64,
}

/// A polyline of the armature with its weight in the cost field.
#[derive(Clone, Debug)]
pub struct CostLine {
    /// The drawn line.
    pub points: Vec<Point>,
    /// Effective metres per metre along it.
    pub multiplier: f64,
    /// Whether it crosses water on a built span.
    pub crossings: bool,
}

/// The key of the founding focus node when the founding places it.
pub fn focus_key() -> Key {
    Key::node(&[1])
}

/// Insert the regional roads, each clipped to `reach` metres of `centre`, into `stage` as chains
/// of class regional road; a road that cannot be drawn without overlapping another is left out.
/// Returns how many road pieces were left out.
pub fn regional_roads(
    stage: &mut Stage,
    event: &Key,
    roads: &[Vec<Point>],
    centre: Point,
    reach: f64,
    width: f64,
) -> usize {
    let mut rank = 0;
    let mut dropped = 0;
    for road in roads {
        for (piece, clipped) in clip(road, centre, reach) {
            let length: f64 = piece.windows(2).map(|w| w[0].distance(w[1])).sum();
            if length < 4.0 * chain::MIN_GAP {
                continue;
            }
            let mut path = piece;
            let last = path.len() - 1;
            let end_kind = |was_clipped: bool| {
                if was_clipped {
                    NodeKind::TownEntry
                } else {
                    NodeKind::DeadEnd
                }
            };
            let (start, a) = seat(stage.graph(), path[0], end_kind(clipped[0]));
            let (end, b) = seat(stage.graph(), path[last], end_kind(clipped[1]));
            path[0] = a;
            path[last] = b;
            let clear = [!matches!(start, Tip::Free(_)), !matches!(end, Tip::Free(_))];
            let Some(hits) = crossings(stage.graph(), &path, clear, false) else {
                dropped += 1;
                continue;
            };
            let draw = Draw {
                event,
                next_rank: &mut rank,
                chain: None,
                class: EdgeClass::RegionalRoad,
                rank: 0,
                width,
            };
            let (ops, _) = chain_ops(draw, &path, start, end, &hits);
            if stage.try_push(ops).is_err() {
                dropped += 1;
            }
        }
    }
    dropped
}

/// Place the founding focus at `at`: on a node of the founding graph within `FOCUS_JOIN`, else on
/// the nearest edge within it, else as a node of its own.
pub fn place_focus(stage: &mut Stage, at: Point) {
    let graph = stage.graph();
    if nearest_node(graph, at, FOCUS_JOIN).is_some() {
        return;
    }
    let on_edge = graph
        .edges_near(Level::Ground, at, FOCUS_JOIN)
        .into_iter()
        .map(|e| {
            let edge = graph.edge(e);
            let (d, q) = nearest_point(&edge.polyline, at);
            (d, q, edge.stem.clone())
        })
        .min_by(|x, y| x.0.total_cmp(&y.0));
    if let Some((_, point, edge)) = on_edge {
        let split = Op::SplitEdge {
            edge,
            point,
            node: focus_key(),
            kind: NodeKind::Junction,
        };
        if stage.try_push(vec![split]).is_ok() {
            return;
        }
    }
    let _ = stage.try_push(vec![Op::AddNode {
        key: focus_key(),
        level: Level::Ground,
        position: at,
        kind: NodeKind::Junction,
    }]);
}

/// The founding focus in a graph built by a founding at `at`.
pub fn focus_node(graph: &Graph, at: Point) -> Option<NodeId> {
    graph
        .node_id(&focus_key())
        .or_else(|| nearest_node(graph, at, FOCUS_JOIN))
}

/// The main axes of the tissue from the founding focus, following classic's organic spines.
#[allow(clippy::too_many_arguments)]
pub fn plan_arms(
    graph: &Graph,
    focus: NodeId,
    roads: &[Vec<Point>],
    terrain: &dyn TerrainView,
    survey: &Survey,
    params: &OrganicParams,
    nucleus_radius: f64,
    founding: &Key,
    mut rng: Rng,
) -> Vec<Arm> {
    let at = graph.node(focus).position;
    let mut angle = nearest_road_angle(at, roads).unwrap_or_else(|| rng.range(0.0, PI));
    match params.orientation {
        FieldOrientation::Cardinal => angle = 0.0,
        FieldOrientation::Terrain => {
            let (gx, gy) = terrain.slope_at(at, survey.cell_size());
            if gx.hypot(gy) > 0.005 {
                angle = gy.atan2(gx) + PI * 0.5;
            }
        }
        FieldOrientation::Water => {
            if let Some(wet) = nearest_wet(survey, at, nucleus_radius * 2.0) {
                angle = (wet.y - at.y).atan2(wet.x - at.x) + PI * 0.5;
            }
        }
        FieldOrientation::Road => {}
    }
    if params.align_to_roads
        && params.orientation != FieldOrientation::Cardinal
        && let Some(regional) = regional_axis(at, nucleus_radius * 1.5, roads)
    {
        angle = regional;
    }
    let roads_out: Vec<f64> = graph
        .arms(focus, Level::Ground)
        .into_iter()
        .filter(|h| *graph.edge(h.edge()).class.current() == EdgeClass::RegionalRoad)
        .map(|h| {
            let edge = graph.edge(h.edge());
            let points: Vec<Point> = if h.is_forward() {
                edge.polyline.clone()
            } else {
                edge.polyline.iter().rev().copied().collect()
            };
            let far = point_along(&points, ROAD_SIGHT);
            (far.y - at.y).atan2(far.x - at.x)
        })
        .collect();
    let doubles = |bearing: f64| {
        roads_out
            .iter()
            .copied()
            .find(|&r| (bearing - r).cos() > ALONG_ROAD)
    };
    let width = |rank: u8| params.width_by_rank[usize::from(rank).min(4)] * params.width_scale;

    // Classic's organic towns radiate six to eight main streets from their centre: three
    // diameters, four for a radial tissue, less those a regional road already runs along.
    let diameters = if params.radial { 4 } else { 3 };
    let mut arms = Vec::new();
    for i in 0..diameters {
        let jitter = if params.radial && i > 0 {
            rng.range(-0.1, 0.1)
        } else {
            0.0
        };
        let bearing = angle + i as f64 * PI / diameters as f64 + jitter;
        let rank = u8::from(i > 0);
        let ends = [bearing, bearing + PI];
        let roads_at = ends.map(doubles);
        let kept: Vec<f64> = match roads_at {
            [Some(_), Some(_)] => vec![],
            [Some(road), None] | [None, Some(road)] => vec![road + PI],
            [None, None] => ends.to_vec(),
        };
        for b in kept {
            arms.push(Arm {
                chain: founding.child(tag::ARM, &[arms.len() as u32]),
                bearing: b,
                rank,
                width: width(rank),
            });
        }
    }
    arms
}

/// The armature's lines with their weights in the cost field: regional roads, axes, and the
/// other streets of the town. Boundaries and the like carry no traffic.
pub fn cost_lines(graph: &Graph, spec: &GrowthSpec, arms: &[Arm]) -> Vec<CostLine> {
    let arm_chains: HashSet<&Key> = arms.iter().map(|a| &a.chain).collect();
    graph
        .live_edges()
        .filter(|&e| graph.edge(e).level == Level::Ground)
        .filter_map(|e| {
            let edge = graph.edge(e);
            let axis = edge.chain.as_ref().is_some_and(|c| arm_chains.contains(c));
            // A regional road keeps its weight once a planned grid takes it as an axis.
            let (multiplier, crossings) = match edge.class.current() {
                EdgeClass::RegionalRoad | EdgeClass::GridAxis => (spec.regional_road_cost, true),
                EdgeClass::Street | EdgeClass::Lane | EdgeClass::Stairs if axis => {
                    (spec.axis_cost, false)
                }
                EdgeClass::Street | EdgeClass::Lane | EdgeClass::Stairs => {
                    (spec.street_cost, false)
                }
                _ => return None,
            };
            Some(CostLine {
                points: edge.polyline.clone(),
                multiplier,
                crossings,
            })
        })
        .collect()
}

/// The lines that orient the street field: regional roads (also once a planned grid takes them
/// as axes) and main axes, in table order.
pub fn field_lines(graph: &Graph, arms: &[Arm]) -> Vec<Vec<Point>> {
    let arm_chains: HashSet<&Key> = arms.iter().map(|a| &a.chain).collect();
    graph
        .live_edges()
        .filter(|&e| {
            let edge = graph.edge(e);
            matches!(
                edge.class.current(),
                EdgeClass::RegionalRoad | EdgeClass::GridAxis
            )
                || edge.chain.as_ref().is_some_and(|c| arm_chains.contains(c))
        })
        .map(|e| graph.edge(e).polyline.clone())
        .collect()
}

/// Where an inserted road end sits: on a node or an edge within `ROAD_JOIN`, else free.
fn seat(graph: &Graph, p: Point, kind: NodeKind) -> (Tip, Point) {
    if let Some(n) = nearest_node(graph, p, ROAD_JOIN) {
        let node = graph.node(n);
        return (Tip::Node(node.key.clone()), node.position);
    }
    let on = graph
        .edges_near(Level::Ground, p, ROAD_JOIN)
        .into_iter()
        .map(|e| {
            let edge = graph.edge(e);
            let (d, q) = nearest_point(&edge.polyline, p);
            (d, q, edge.stem.clone())
        })
        .min_by(|x, y| x.0.total_cmp(&y.0));
    match on {
        Some((_, q, stem)) => (Tip::OnEdge(stem), q),
        None => (Tip::Free(kind), p),
    }
}

/// The live node nearest `p` within `radius` that ends an edge near it, by distance then key.
fn nearest_node(graph: &Graph, p: Point, radius: f64) -> Option<NodeId> {
    graph
        .edges_near(Level::Ground, p, radius)
        .into_iter()
        .flat_map(|e| graph.edge(e).nodes)
        .filter(|&n| graph.node(n).position.distance(p) <= radius)
        .min_by(|&a, &b| {
            let (na, nb) = (graph.node(a), graph.node(b));
            na.position
                .distance(p)
                .total_cmp(&nb.position.distance(p))
                .then_with(|| na.key.cmp(&nb.key))
        })
}

/// Distance from `p` to a polyline and the nearest point on it.
fn nearest_point(polyline: &[Point], p: Point) -> (f64, Point) {
    polyline
        .windows(2)
        .map(|w| {
            let (d, _, q) = distance(p, w[0], w[1]);
            (d, q)
        })
        .fold(
            (f64::INFINITY, p),
            |best, x| if x.0 < best.0 { x } else { best },
        )
}

/// The point `length` metres along a polyline, or its last point.
fn point_along(points: &[Point], length: f64) -> Point {
    let mut left = length;
    for w in points.windows(2) {
        let d = w[0].distance(w[1]);
        if d >= left && d > 0.0 {
            let t = left / d;
            return Point {
                x: w[0].x + (w[1].x - w[0].x) * t,
                y: w[0].y + (w[1].y - w[0].y) * t,
            };
        }
        left -= d;
    }
    points[points.len() - 1]
}

/// Direction of the road segment nearest `p` (classic's `nearest`).
fn nearest_road_angle(p: Point, roads: &[Vec<Point>]) -> Option<f64> {
    roads
        .iter()
        .flat_map(|r| r.windows(2))
        .map(|w| {
            (
                distance(p, w[0], w[1]).0,
                (w[1].y - w[0].y).atan2(w[1].x - w[0].x),
            )
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, angle)| angle)
}

/// Classic's `regional_axis`: the tangent of the road that weighs most near `p`, its weight the
/// length of its segments within `reach`, damped by their distance.
fn regional_axis(p: Point, reach: f64, roads: &[Vec<Point>]) -> Option<f64> {
    roads
        .iter()
        .enumerate()
        .filter_map(|(i, road)| {
            let mut score = 0.0;
            let mut tangent: Option<(f64, f64)> = None;
            for w in road.windows(2) {
                let length = w[0].distance(w[1]);
                let (d, _, _) = distance(p, w[0], w[1]);
                if length <= 1e-6 || d > reach {
                    continue;
                }
                score += length.min(reach * 2.0) / (1.0 + d / (reach * 0.3).max(1.0)).powi(2);
                if tangent.is_none_or(|(nearest, _)| d < nearest) {
                    tangent = Some((d, (w[1].y - w[0].y).atan2(w[1].x - w[0].x)));
                }
            }
            tangent.map(|(_, angle)| (score, i, angle))
        })
        .min_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)))
        .map(|v| v.2)
}

/// The nearest wet surveyed cell within `radius` of `p`.
fn nearest_wet(survey: &Survey, p: Point, radius: f64) -> Option<Point> {
    survey
        .cells()
        .filter(|c| c.wet && c.position.distance(p) <= radius)
        .map(|c| c.position)
        .min_by(|a, b| {
            a.distance(p)
                .total_cmp(&b.distance(p))
                .then(a.x.total_cmp(&b.x))
        })
}

/// The pieces of a polyline inside the disc of `radius` around `centre`, each with whether
/// its start and end were cut by the disc.
fn clip(road: &[Point], centre: Point, radius: f64) -> Vec<(Vec<Point>, [bool; 2])> {
    let inside = |p: Point| p.distance(centre) <= radius;
    let mut out = Vec::new();
    let mut current: Option<(Vec<Point>, bool)> = None;
    for w in road.windows(2) {
        let (a, b) = (w[0], w[1]);
        let (ta, tb) = disc_span(a, b, centre, radius);
        if ta > tb {
            if let Some((points, cut)) = current.take() {
                out.push((points, [cut, true]));
            }
            continue;
        }
        let lerp = |t: f64| Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
        let (p, q) = (lerp(ta), lerp(tb));
        let continues = ta <= 0.0 && current.is_some();
        if continues {
            if let Some((points, _)) = current.as_mut() {
                points.push(q);
            }
        } else {
            if let Some((points, cut)) = current.take() {
                out.push((points, [cut, true]));
            }
            current = Some((vec![p, q], ta > 0.0 || !inside(a)));
        }
        if tb < 1.0
            && let Some((points, cut)) = current.take()
        {
            out.push((points, [cut, true]));
        }
    }
    if let Some((points, cut)) = current {
        out.push((points, [cut, false]));
    }
    for (points, _) in &mut out {
        points.dedup_by(|p, q| p.distance(*q) < 1e-9);
    }
    out.retain(|(points, _)| points.len() >= 2);
    out
}

/// The parameter interval of segment `ab` inside the disc, empty when `t0 > t1`.
fn disc_span(a: Point, b: Point, centre: Point, radius: f64) -> (f64, f64) {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let (fx, fy) = (a.x - centre.x, a.y - centre.y);
    let qa = dx * dx + dy * dy;
    if qa < 1e-18 {
        return if a.distance(centre) <= radius {
            (0.0, 1.0)
        } else {
            (1.0, 0.0)
        };
    }
    let qb = 2.0 * (fx * dx + fy * dy);
    let qc = fx * fx + fy * fy - radius * radius;
    let disc = qb * qb - 4.0 * qa * qc;
    if disc < 0.0 {
        return (1.0, 0.0);
    }
    let root = disc.sqrt();
    let t0 = ((-qb - root) / (2.0 * qa)).max(0.0);
    let t1 = ((-qb + root) / (2.0 * qa)).min(1.0);
    (t0, t1)
}
