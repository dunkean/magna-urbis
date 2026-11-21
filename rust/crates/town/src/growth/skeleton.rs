//! The street skeleton (design 4.4): classic's macroplan, laid ahead of the houses.
//!
//! Classic delimits its quarters by streets: regional roads, main streets (spines) running out
//! from the centre and bending with the street field and the ground, and quarter streets cutting
//! the land between them by balanced, field-traced cuts (`macroplan.rs`, `cultural_spines` and
//! its recursive split). Growth draws the same skeleton once, at founding, over all the land the
//! survey reaches, and opens it quarter by quarter afterwards:
//! - the land's own limits (banks, cliffs, neighbours, the reach) are boundary edges of rank
//!   [`LIMIT_RANK`], never streets;
//! - each main axis is traced from the focus through the organic street field (the field the
//!   tissue lays its streets with), pulled back towards its bearing so that it keeps running
//!   outwards, turned aside by closed land; it crosses regional roads and stops on the land's limit
//!   or on an earlier axis;
//! - the land between roads and axes is cut by the organic tissue's own recursive split, run
//!   with quarter-sized targets that widen with the distance from the focus: the cuts are traced
//!   through the field, so junctions come out as T's and oblique crossings, and the cells are
//!   irregular.
//!
//! Axes and quarter streets are drawn as boundary edges with their street rank and width: they
//! are planned, not built. A quarter that opens turns the axes along it, and the quarter streets
//! it shares with older quarters, into streets (`commit::retypes`); its other edges stay
//! provisional, and the town's outer edge is what the last quarters' tissue drew.
//!
//! The skeleton depends on the site, the charter and the seed only, never on the target, so the
//! prefix property holds. Far banks a crossing opens get theirs when they are reached.

use std::collections::HashSet;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

use magna_urbis_geom::{self as g, Point, Shape};
use magna_urbis_random::Rng;

use super::contour::Lattice;
use super::driver::Driver;
use super::par;
use crate::armature::{self, Arm, BoundaryArc, Draw, Hit, Tip, chain_ops, crossings};
use crate::graph::{Clock, Edge, EdgeClass, FaceKind, Graph, Key, Level, NodeKind};
use crate::journal::{EventKind, Op, Stage, event_stream};
use crate::survey::Survey;
use crate::tissue::organic::{self, OrganicParams, OrganicSite, StreetField};
use crate::water;

/// Rank of the land's own limits (banks, cliffs, the reach): below every street, never one.
pub(super) const LIMIT_RANK: u8 = 4;
/// Drawn width of a limit in metres.
const LIMIT_WIDTH: f64 = 1.0;
/// Step of an axis traced through the field (metres).
const STEP: f64 = 15.0;
/// Largest turn of an axis per step (radians, about 7 degrees).
const MAX_TURN: f64 = 0.12;
/// Share of the street field in an axis's heading; the rest pulls it back to its bearing.
const FIELD_PULL: f64 = 0.55;
/// Turns tried, in radians, when an axis's next step falls on closed land.
const DETOURS: [f64; 5] = [0.0, 0.26, -0.26, 0.52, -0.52];
/// Straight run in metres an axis is prolonged by to meet the land's limit.
const AXIS_REACH: f64 = 45.0;
/// Metres a quarter street's ends are prolonged by to find the lines they end on.
const SEAT: f64 = 4.0;
/// Rounds of quarter streets: the first splits every face, the next ones the faces left larger
/// than `LEFT_LARGE` quarters where they lie.
const SPLIT_ROUNDS: usize = 4;
const LEFT_LARGE: f64 = 2.5;

impl Driver<'_> {
    /// The founding skeleton, as `ExtendArmature { ring: 0 }`: the limits of the land the focus
    /// reaches, the main axes and the quarter streets.
    pub(super) fn found_skeleton(&mut self) -> Result<(), String> {
        let kind = EventKind::ExtendArmature { ring: 0 };
        let event = kind.key();
        if !self.may_apply(&event) {
            return Ok(());
        }
        let domains = match self.frozen.as_ref() {
            Some(costs) => Lattice::new(&self.survey, costs)
                .land(f64::INFINITY, &[])
                .map(|l| l.outlines)
                .unwrap_or_default(),
            None => Vec::new(),
        };
        let applied = self.event(kind, |d, at| Some(d.skeleton(&event, at, &domains, true)))?;
        if std::env::var_os("URBAN_PROFILE").is_some() {
            let graph = self.writer.graph();
            eprintln!(
                "  growth.skeleton domains={} applied={applied:?} edges={} faces={}",
                domains.len(),
                graph.live_edges().count(),
                graph.live_faces().count()
            );
        }
        Ok(())
    }

    /// The skeleton of the far banks a crossing opened and no skeleton covers yet, as
    /// `ExtendArmature { ring: step }`: their limits and quarter streets.
    pub(super) fn far_skeleton(&mut self, step: u32, lattice: &Lattice) -> Result<(), String> {
        let graph = self.writer.graph();
        let seeds = water::far_landings(graph, self.writer.journal());
        if seeds.is_empty() {
            return Ok(());
        }
        let Some(land) = lattice.land(f64::INFINITY, &seeds) else {
            return Ok(());
        };

        let outside = graph.outside(Level::Ground);
        let fresh: Vec<Vec<Point>> = land
            .outlines
            .into_iter()
            .skip(1)
            .filter(|o| {
                let shape = Shape {
                    outer: o.clone(),
                    holes: vec![],
                };
                graph.face_at(Level::Ground, g::interior_point(&shape)) == outside
            })
            .collect();
        if fresh.is_empty() {
            return Ok(());
        }
        let kind = EventKind::ExtendArmature { ring: step };
        let event = kind.key();
        let applied = self.event(kind, |d, at| Some(d.skeleton(&event, at, &fresh, false)))?;
        if std::env::var_os("URBAN_PROFILE").is_some() {
            eprintln!("  growth.skeleton far step={step} pieces={} applied={applied:?}", fresh.len());
        }
        Ok(())
    }

    /// The operations of a skeleton over the land pieces `domains` (outlines, counter-clockwise).
    fn skeleton(&self, event: &Key, at: Clock, domains: &[Vec<Point>], axes: bool) -> Vec<Op> {
        let mut stage = self.writer.stage(at);
        let mut rank = 0;
        for outline in domains {
            for arc in armature::arcs(stage.graph(), outline, 0.0) {
                insert_limit(&mut stage, event, &mut rank, arc);
            }
        }
        let params = self.organic(0);
        let site = OrganicSite {
            centre: self.focus_position(),
            radius: self.spec.nucleus_radius,
            field: Rng::new(self.request.seed).fork("organic-field"),
        };
        let mut lines = self.road_lines.clone();
        if axes && let Some(focus) = self.focus {
            let field = StreetField::new(self.request.terrain, &self.road_lines, &site, &params);
            let from = self.writer.graph().node(focus).position;
            let focus_key = self.writer.graph().node(focus).key.clone();
            for arm in &self.arms {
                let path = trace_axis(&field, &self.survey, from, arm.bearing, self.spec.reach);
                if let Some(drawn) =
                    lay_axis(&mut stage, event, &mut rank, arm, &self.arms, &focus_key, path)
                {
                    lines.push(drawn);
                }
            }
        }
        // The land between roads and axes, cut by the tissue's split with quarter-sized targets.
        let skeleton = self.skeleton_params(&params);
        let pieces: Vec<Shape> = domains
            .iter()
            .map(|o| Shape {
                outer: o.clone(),
                holes: vec![],
            })
            .collect();
        // A cut the graph refuses leaves the cuts traced to it unseated: the faces still much
        // larger than a quarter are split again, each round with fresh streams.
        let focus = site.centre;
        let quarter = |p: Point| {
            self.spec.quarter_area.max(1000.0)
                * (1.0 + p.distance(focus) / self.spec.quarter_growth.max(1.0))
        };
        for round in 0..SPLIT_ROUNDS {
            let graph = stage.graph();
            let outside = graph.outside(Level::Ground);
            let mut faces: Vec<(Key, Shape)> = graph
                .live_faces()
                .filter(|&f| {
                    f != outside
                        && graph.face(f).level == Level::Ground
                        && *graph.face(f).kind.current() == FaceKind::Unbuilt
                })
                .filter_map(|f| {
                    let outline = graph.outline(f)?;
                    let inside = g::interior_point(&outline);
                    let floor = if round == 0 {
                        2.0 * skeleton.min_block
                    } else {
                        LEFT_LARGE * quarter(inside)
                    };
                    (g::area(&outline) > floor && pieces.iter().any(|p| g::contains(p, inside)))
                        .then(|| (graph.face(f).key.clone(), outline))
                })
                .collect();
            if faces.is_empty() {
                break;
            }
            faces.sort_by(|a, b| a.0.cmp(&b.0));
            let terrain = self.request.terrain;
            let seed = self.request.seed;
            let cuts = par::map(&faces, |_, (key, outline)| {
                let mut rng = event_stream(seed, key).fork(&format!("round:{round}"));
                organic::lay_streets(outline, terrain, &lines, &site, &skeleton, &mut rng).streets
            });
            for street in cuts.into_iter().flatten() {
                // The split's streets are quarter streets (classic's rank 1), its lanes rank 2.
                let r: u8 = if street.rank <= 2 { 1 } else { 2 };
                let width = params.width_by_rank[usize::from(r)] * params.width_scale;
                insert_cut(&mut stage, event, &mut rank, &street.path, r, width);
            }
        }
        stage.into_ops()
    }

    /// The tissue's split parameters for quarters: targets from the growth spec, no small
    /// places, no stairs.
    fn skeleton_params(&self, base: &OrganicParams) -> OrganicParams {
        let a = self.spec.quarter_area.max(1000.0);
        OrganicParams {
            block_size: [0.9 * a, 1.9 * a],
            min_block: 0.3 * a,
            min_width: 40.0,
            place_threshold: 0.0,
            long_cut: 0.0,
            max_aspect: 2.4,
            target_growth: self.spec.quarter_growth,
            allow_stairs: false,
            ..base.clone()
        }
    }
}

/// Whether an edge is a planned street of the skeleton: an axis (its chain among `arms`) or a
/// quarter street, still a boundary.
pub(super) fn planned_street(edge: &Edge, arms: &HashSet<&Key>) -> bool {
    if *edge.class.current() != EdgeClass::Boundary {
        return false;
    }
    if edge.chain.as_ref().is_some_and(|c| arms.contains(c)) {
        return true;
    }
    let parts = edge.stem.parts();
    *edge.rank.current() < LIMIT_RANK
        && parts.get(3).is_some_and(|&ring| {
            parts.starts_with(EventKind::ExtendArmature { ring }.key().parts())
        })
}

/// A main axis traced from `from` on `bearing` through the street field, for at most `reach`
/// metres or until closed land stops it.
fn trace_axis(
    field: &StreetField<'_>,
    survey: &Survey,
    from: Point,
    bearing: f64,
    reach: f64,
) -> Vec<Point> {
    let mut path = vec![from];
    let (mut p, mut heading) = (from, bearing);
    for _ in 0..(reach / STEP).ceil() as usize {
        let a = field.angle(p);
        let along = (0..4)
            .map(|k| a + f64::from(k) * FRAC_PI_2)
            .min_by(|x, y| turn(heading, *x).abs().total_cmp(&turn(heading, *y).abs()))
            .unwrap_or(heading);
        let want = FIELD_PULL * turn(heading, along) + (1.0 - FIELD_PULL) * turn(heading, bearing);
        let bend = want.clamp(-MAX_TURN, MAX_TURN);
        let next = DETOURS.iter().find_map(|&detour| {
            let h = heading + bend + detour;
            let q = Point {
                x: p.x + STEP * h.cos(),
                y: p.y + STEP * h.sin(),
            };
            (!survey.closed_at(q)).then_some((h, q))
        });
        let Some((h, q)) = next else {
            break;
        };
        heading = h;
        p = q;
        path.push(q);
    }
    g::simplify(&path, 1.0, |_| false)
}

/// The signed turn from heading `from` to heading `to`, in (-pi, pi].
fn turn(from: f64, to: f64) -> f64 {
    (to - from + PI).rem_euclid(TAU) - PI
}

/// Insert an axis traced as `path` from the focus: it runs on across regional roads and stops
/// on the first other line it meets (the land's limit, an earlier axis), prolonged a little to
/// reach it. Returns the drawn line.
fn lay_axis(
    stage: &mut Stage,
    event: &Key,
    rank: &mut u32,
    arm: &Arm,
    arms: &[Arm],
    focus: &Key,
    path: Vec<Point>,
) -> Option<Vec<Point>> {
    if path.len() < 2 {
        return None;
    }
    let n = path.len();
    let mut long = path.clone();
    long.push(along(path[n - 2], path[n - 1], AXIS_REACH));
    let chains: HashSet<&Key> = arms.iter().map(|a| &a.chain).collect();
    let graph = stage.graph();
    let hits = crossings(graph, &long, [true, false], false)?;
    let passes = |hit: &Hit| {
        let edge = graph.edge(hit.edge);
        matches!(
            edge.class.current(),
            EdgeClass::RegionalRoad
                | EdgeClass::GridAxis
                | EdgeClass::HarbourRoad
                | EdgeClass::CastleRoad
        ) || (*edge.class.current() == EdgeClass::Bridge && edge.road_source.is_some())
            || (edge.chain.as_ref().is_some_and(|c| chains.contains(c))
                && *edge.class.current() != EdgeClass::Boundary)
    };
    let stop = hits
        .iter()
        .position(|h| !passes(h))
        .or_else(|| hits.len().checked_sub(1))?;
    let end = &hits[stop];
    let mut cut = long[..=end.segment].to_vec();
    cut.push(end.point);
    cut.dedup_by(|p, q| p.distance(*q) < 1e-9);
    if cut.len() < 2 {
        return None;
    }
    let inner = crossings(graph, &cut, [true, true], false)?;
    let draw = Draw {
        event,
        next_rank: rank,
        chain: Some(arm.chain.clone()),
        class: EdgeClass::Boundary,
        rank: arm.rank,
        width: arm.width,
    };
    let (ops, _) = chain_ops(draw, &cut, Tip::Node(focus.clone()), end.tip(), &inner);
    stage.try_push(ops).ok()?;
    Some(cut)
}

/// Insert a stretch of the land's limit. A loop that starts on an existing edge is drawn in two
/// halves, since the node its start makes is only known once drawn.
fn insert_limit(stage: &mut Stage, event: &Key, rank: &mut u32, arc: BoundaryArc) {
    fn draw<'a>(event: &'a Key, rank: &'a mut u32) -> Draw<'a> {
        Draw {
            event,
            next_rank: rank,
            chain: None,
            class: EdgeClass::Boundary,
            rank: LIMIT_RANK,
            width: LIMIT_WIDTH,
        }
    }
    let closes_on_edge = arc.end == Tip::Start && !matches!(arc.start, Tip::Free(_));
    if !closes_on_edge {
        let (ops, _) = chain_ops(draw(event, rank), &arc.path, arc.start, arc.end, &arc.hits);
        let _ = stage.try_push(ops);
        return;
    }
    let n = arc.path.len();
    if n < 3 {
        return;
    }
    let m = n / 2;
    let (first, second) = (&arc.path[..=m], &arc.path[m..]);
    let Some(hits) = crossings(stage.graph(), first, [true, false], false) else {
        return;
    };
    let (ops, _) = chain_ops(draw(event, rank), first, arc.start, Tip::Free(NodeKind::Junction), &hits);
    if stage.try_push(ops).is_err() {
        return;
    }
    let graph = stage.graph();
    let (Some(from), Some(to)) = (node_at(graph, second[0]), node_at(graph, arc.path[0])) else {
        return;
    };
    let Some(hits) = crossings(graph, second, [true, true], false) else {
        return;
    };
    let (ops, _) = chain_ops(draw(event, rank), second, Tip::Node(from), Tip::Node(to), &hits);
    let _ = stage.try_push(ops);
}

/// The key of the live node at `p`, if any.
fn node_at(graph: &Graph, p: Point) -> Option<Key> {
    graph
        .edges_near(Level::Ground, p, 0.01)
        .into_iter()
        .flat_map(|e| graph.edge(e).nodes)
        .find(|&n| graph.node(n).position.distance(p) < 0.01)
        .map(|n| graph.node(n).key.clone())
}

/// Insert a quarter street traced by the split: its ends, prolonged by `SEAT`, are seated on
/// the lines they were traced to. A street that cannot be seated at both ends is left out.
fn insert_cut(stage: &mut Stage, event: &Key, rank: &mut u32, path: &[Point], r: u8, width: f64) {
    let n = path.len();
    if n < 2 {
        return;
    }
    let mut long = vec![along(path[1], path[0], SEAT)];
    long.extend_from_slice(path);
    long.push(along(path[n - 2], path[n - 1], SEAT));
    let total: f64 = long.windows(2).map(|w| w[0].distance(w[1])).sum();
    let graph = stage.graph();
    let Some(hits) = crossings(graph, &long, [false, false], false) else {
        return;
    };
    let (Some(first), Some(last)) = (hits.first(), hits.last()) else {
        return;
    };
    if hits.len() < 2 || first.along > 2.0 * SEAT || last.along < total - 2.0 * SEAT {
        return;
    }
    let (start, end) = (first.tip(), last.tip());
    if matches!((&start, &end), (Tip::Node(a), Tip::Node(b)) if a == b) {
        return;
    }
    let mut cut = vec![first.point];
    cut.extend_from_slice(&long[first.segment + 1..=last.segment]);
    cut.push(last.point);
    cut.dedup_by(|p, q| p.distance(*q) < 1e-9);
    if cut.len() < 2 {
        return;
    }
    let Some(inner) = crossings(graph, &cut, [true, true], false) else {
        return;
    };
    let draw = Draw {
        event,
        next_rank: rank,
        chain: None,
        class: EdgeClass::Boundary,
        rank: r,
        width,
    };
    let (ops, _) = chain_ops(draw, &cut, start, end, &inner);
    let _ = stage.try_push(ops);
}

/// The point `length` metres beyond `b` on the line from `a` through `b`.
fn along(a: Point, b: Point, length: f64) -> Point {
    let d = a.distance(b).max(1e-9);
    Point {
        x: b.x + (b.x - a.x) / d * length,
        y: b.y + (b.y - a.y) / d * length,
    }
}
