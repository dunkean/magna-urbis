//! Fortified camps' enclosures as a precinct variant (design 5.3). On a flat site the precinct is
//! a regular figure sized for one unit of the culture, not for the target; a daughter figure is a
//! lobe and a concentric row a step, through the ordinary precinct survey. On a defensive site
//! (spur, hilltop, meander, island) it is the scarp line round the high ground plus a straight
//! cross-rampart at the neck, traced at full terrain adherence; there enclosed land may stay open,
//! typed common up to the culture's share.

use std::collections::HashSet;

use magna_urbis_geom::{self as g, Point, Shape};

use super::land::{cells_outline, land_for};
use super::precinct::{Circuit, PrecinctPlan, PrecinctSite, Purpose, curtain_width, lay};
use super::{Candidate, TraceFamily, Traced, trace};
use crate::graph::{Clock, EdgeClass, FaceKind, Graph, Level};
use crate::journal::{Op, Writer};
use crate::spec::{PrecinctSpec, WallKind};
use crate::survey::Survey;

/// Farthest a defensive camp's scarp line runs from its focus (metres).
const SCARP_REACH: f64 = 600.0;
/// A neck is no closer to the focus than this (metres).
const NECK_MIN: f64 = 40.0;
/// A neck is a distance band holding at most this share of the widest band before it.
const NECK_SHARE: f64 = 0.4;

/// The flat camp's figure: a rectangle of `spec.camp_aspect` (long side along `bearing`, in
/// radians) holding one unit at `density` gross inhabitants per hectare, centred on `centre`.
pub fn flat_figure(centre: Point, bearing: f64, density: f64, spec: &PrecinctSpec) -> Shape {
    let area = land_for(f64::from(spec.camp_unit), 1.0, density);
    let aspect = spec.camp_aspect.max(1.0);
    let width = (area / aspect).sqrt();
    let (hl, hw) = (0.5 * width * aspect, 0.5 * width);
    let (c, s) = (bearing.cos(), bearing.sin());
    let at = |u: f64, v: f64| Point {
        x: centre.x + u * c - v * s,
        y: centre.y + u * s + v * c,
    };
    g::normalized(Shape {
        outer: vec![at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw)],
        holes: vec![],
    })
}

/// A defensive camp's figure: the high ground round `focus`, open cells no lower than the
/// focus's own cell less `spec.scarp_drop`, flooded from the focus and cut at the neck where it
/// joins the plateau behind (the narrowest distance band beyond `NECK_MIN`). Returns the
/// outline and the neck's two ends, the line of the cross-rampart, when there is one.
pub fn defensive_figure(
    survey: &Survey,
    focus: Point,
    spec: &PrecinctSpec,
) -> Option<(Shape, Option<(Point, Point)>)> {
    let step = survey.cell_size();
    let start = survey.cell_at(focus)?;
    let floor = start.elevation - spec.scarp_drop;
    let mut region: Vec<Point> = vec![start.position];
    let mut seen = HashSet::from([start.index]);
    let mut k = 0;
    while k < region.len() {
        let p = region[k];
        k += 1;
        for (dx, dy) in [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
            let q = Point {
                x: p.x + dx * step,
                y: p.y + dy * step,
            };
            let Some(cell) = survey.cell_at(q) else {
                continue;
            };
            if cell.closed
                || cell.elevation < floor
                || cell.position.distance(focus) > SCARP_REACH
                || !seen.insert(cell.index)
            {
                continue;
            }
            region.push(cell.position);
        }
    }
    // Cells per distance band from the focus; the neck is the first band, past the widest band
    // so far, thinner than `NECK_SHARE` of it with land beyond.
    let bands = (SCARP_REACH / step).ceil() as usize + 1;
    let mut count = vec![0usize; bands];
    for p in &region {
        count[((p.distance(focus) / step) as usize).min(bands - 1)] += 1;
    }
    let last = count.iter().rposition(|&c| c > 0)?;
    let mut widest = 0;
    let mut neck = None;
    for (b, &c) in count.iter().enumerate().take(last) {
        widest = widest.max(c);
        if (b as f64) * step >= NECK_MIN && c > 0 && (c as f64) <= NECK_SHARE * widest as f64 {
            neck = Some(b);
            break;
        }
    }
    let cut = neck.map_or(f64::INFINITY, |b| b as f64 * step);
    let inside: Vec<Point> = region
        .iter()
        .copied()
        .filter(|p| p.distance(focus) < cut)
        .collect();
    let outline = cells_outline(survey, &inside, focus)?;
    let rampart = neck.and_then(|b| {
        let band: Vec<Point> = region
            .iter()
            .copied()
            .filter(|p| ((p.distance(focus) / step) as usize) == b)
            .collect();
        let a = *band.first()?;
        let far = band
            .iter()
            .copied()
            .max_by(|x, y| x.distance(a).total_cmp(&y.distance(a)))?;
        Some((a, far))
    });
    Some((outline, rampart))
}

/// The common of a defensive camp: the part of its land farthest from `focus`, `share` of it,
/// beyond a circle round the focus found by bisection.
pub fn common_land(land: &Shape, focus: Point, share: f64) -> Option<Shape> {
    let total = g::area(land);
    if share <= 0.0 || total <= 0.0 {
        return None;
    }
    let far = land
        .outer
        .iter()
        .map(|p| p.distance(focus))
        .fold(0.0, f64::max);
    let disc = |r: f64| {
        let outer = (0..48)
            .map(|k| {
                let a = f64::from(k) * std::f64::consts::TAU / 48.0;
                Point {
                    x: focus.x + r * a.cos(),
                    y: focus.y + r * a.sin(),
                }
            })
            .collect();
        Shape {
            outer,
            holes: vec![],
        }
    };
    let (mut lo, mut hi) = (0.0, far);
    for _ in 0..24 {
        let r = 0.5 * (lo + hi);
        let kept: f64 = g::intersection(land, &disc(r)).iter().map(g::area).sum();
        if kept < (1.0 - share) * total {
            lo = r;
        } else {
            hi = r;
        }
    }
    g::difference(land, &disc(hi))
        .into_iter()
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
}

/// Survey a camp's precinct from its `figure`: a flat figure as it is, a defensive one traced
/// at full terrain adherence. A defensive camp keeps `spec.camp_common_share` of its land closed
/// as common; the loop types the faces left there with [`common_ops`] at the finish.
#[allow(clippy::too_many_arguments)]
pub fn survey_camp(
    writer: &Writer,
    survey: &Survey,
    figure: Shape,
    defensive: bool,
    kind: Option<WallKind>,
    index: u32,
    households: f64,
    clock: Clock,
    site: &PrecinctSite<'_>,
) -> Option<PrecinctPlan> {
    let focus = survey.center();
    let traced = if defensive {
        let mut wall = site.wall.clone();
        wall.terrain_adherence = 1.0;
        let mut candidate = Candidate::new(figure);
        candidate.curtain_width = curtain_width(kind);
        candidate.small = true;
        trace(&candidate, site.terrain, &wall)
    } else {
        Traced {
            corners: figure.outer.clone(),
            outline: figure,
            family: TraceFamily::Square,
            style: site.wall.style.clone(),
            salients: vec![],
            shared: vec![],
            warnings: vec![],
        }
    };
    let common = defensive
        .then(|| common_land(&traced.outline, focus, site.spec.camp_common_share))
        .flatten();
    let circuit = Circuit {
        index,
        purpose: Purpose::Camp,
        traced,
        standing: None,
        kind,
        class: EdgeClass::Precinct,
        wall_street: true,
        sized_for: households,
        clock,
        attached_to: None,
        joins_castle: false,
        enclosed_before: None,
        closed: common.iter().cloned().collect(),
    };
    let mut stage = writer.stage(clock);
    let mut plan = lay(&mut stage, survey, site, circuit)?;
    if let Some(common) = &common
        && let Some(open) = g::difference(&plan.precinct.land, common)
            .into_iter()
            .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
    {
        plan.precinct.land = open;
    }
    plan.ops = stage.into_ops();
    Some(plan)
}

/// Type the unbuilt faces left on a camp's common as common land.
pub fn common_ops(graph: &Graph, common: &Shape) -> Vec<Op> {
    let outside = graph.outside(Level::Ground);
    graph
        .live_faces()
        .filter(|&f| f != outside && graph.face(f).level == Level::Ground)
        .filter(|&f| *graph.face(f).kind.current() == FaceKind::Unbuilt)
        .filter_map(|f| {
            let shape = graph.outline(f)?;
            g::contains(common, g::interior_point(&shape)).then(|| Op::SetFaceKind {
                face: graph.face(f).key.clone(),
                kind: FaceKind::Common,
            })
        })
        .collect()
}
