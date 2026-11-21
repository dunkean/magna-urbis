//! From faces to buildable land: the part of a face that lots may use.
//!
//! A face's buildable land is the face minus the land its boundary edges take (each edge's
//! half-width on the face's side, by its width profile), minus the shapes carved out of it
//! (wall works, reserves, plazas). It is computed per face from that face's own boundary, so
//! two neighbouring blocks never depend on a shared difference and no hairline is left
//! between them.
//!
//! **Method: one-sided strokes, unioned and subtracted.** Every boundary edge is walked with
//! the face on its left and turned into convex pieces: one quad per segment, from the centre
//! line to the offset at the half-widths of its two ends (so widths vary linearly along a
//! segment), and one join where the walk turns away from the face, inside an edge or from one
//! edge to the next at a node. A join is a miter up to where the two offset lines meet, or a
//! bevel when the miter would reach further than `miter_limit` half-widths; turning back on
//! itself at a dead end, the bevel is flat, so a cul-de-sac cuts a square-ended slot. Where the
//! walk turns towards the face, the quads overlap and their union ends on the intersection of
//! the offset lines, however sharp the corner. The pieces and the carved shapes are unioned
//! once, and the union is subtracted from the face in a single difference.
//!
//! This is preferred over offsetting the face's ring: an offset needs one distance per side
//! (varying widths, zero-width boundaries, dangling trees walked on both sides) and must
//! resolve its own self-intersections when an edge is wider than the face is deep, when a
//! very short edge sits between two sharp turns, or when the face pinches. The strokes are
//! simple convex polygons; the overlay alone decides the topology of what remains, which may
//! be nothing, several pieces, or pieces with holes.
//!
//! **Cleaning.** The outlines are snapped (jogs and needle tips dropped, near-collinear
//! vertices merged). Where a piece may hold parts narrower than `min_width`, it is opened by a
//! disc of that diameter (eroded and dilated by the same strokes), which removes slivers,
//! tails and necks and keeps the corners of 60° and more exactly. Pieces under `min_area` go.

mod clean;
mod stroke;
#[cfg(test)]
mod tests;

use magna_urbis_geom::{
    Point, Shape, difference, difference_many, normalized, overlay_fallbacks, union,
};
use serde::{Deserialize, Serialize};

use crate::graph::{Clock, EdgeClass, FaceId, Graph};
use stroke::{Path, cover, links};

/// Which side of its polyline a boundary edge has the block on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    /// On the left, walking the polyline from its first point.
    Left,
    /// On the right.
    Right,
    /// On both sides: an edge dangling inside the face, or one joining a hole to the outline.
    Both,
}

/// One edge of a face's boundary as the block sees it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryEdge {
    /// Centre line in map-local metres.
    pub polyline: Vec<Point>,
    /// Drawn width in metres at each polyline vertex (the last value repeats if short).
    pub widths: Vec<f64>,
    /// What the edge is; `BlockSpec::reserves` may replace its drawn width by class.
    pub class: EdgeClass,
    /// Where the block lies.
    pub side: Side,
}

/// Land an edge class takes from the blocks beside it, in place of half its drawn width.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassReserve {
    /// The class the rule applies to.
    pub class: EdgeClass,
    /// Half-width in metres taken whatever the drawn width; half the drawn width when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub half_width: Option<f64>,
    /// Metres added to the half-width.
    #[serde(default)]
    pub margin: f64,
}

/// How a face becomes buildable land.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BlockSpec {
    /// Parts narrower than this (m) are opened away. The default 4 m is classic's `MIN_LAND`,
    /// the narrowest strip of land it leaves between two ways.
    pub min_width: f64,
    /// Pieces smaller than this (m²) are dropped. The default 1 m² is classic's cut-off for
    /// the pieces its ribbon differences leave.
    pub min_area: f64,
    /// A vertex within this distance (m) of the previous one is dropped. The default 5 cm is
    /// classic's `JOG`, below which a jog splits a frontage without meaning.
    pub jog: f64,
    /// A vertex within this distance (m) of the line through its neighbours is dropped. The
    /// default 1 cm merges the vertices the overlay leaves on straight sides and moves no
    /// outline visibly.
    pub collinear: f64,
    /// Longest miter, in half-widths, before a turn is bevelled. The default 2 keeps corners
    /// of 60° and more square to their streets.
    pub miter_limit: f64,
    /// Per-class replacements of the drawn half-width; classes not listed take half their
    /// drawn width. By default a boundary takes nothing: it marks a limit, not a way.
    pub reserves: Vec<ClassReserve>,
}

impl Default for BlockSpec {
    fn default() -> Self {
        Self {
            min_width: 4.0,
            min_area: 1.0,
            jog: 0.05,
            collinear: 0.01,
            miter_limit: 2.0,
            reserves: vec![ClassReserve {
                class: EdgeClass::Boundary,
                half_width: Some(0.0),
                margin: 0.0,
            }],
        }
    }
}

impl BlockSpec {
    /// Half-width in metres an edge of `class` drawn `drawn` metres wide takes from a block.
    pub fn half_width(&self, class: EdgeClass, drawn: f64) -> f64 {
        let half = match self.reserves.iter().find(|r| r.class == class) {
            Some(rule) => rule.half_width.unwrap_or(drawn * 0.5) + rule.margin,
            None => drawn * 0.5,
        };
        if half.is_finite() { half.max(0.0) } else { 0.0 }
    }
}

/// The buildable land of a face with the default `BlockSpec`: `face_outline` minus the
/// half-widths of its `boundary` edges, minus the `carved` shapes. Possibly nothing.
pub fn buildable(face_outline: &Shape, boundary: &[BoundaryEdge], carved: &[Shape]) -> Vec<Shape> {
    buildable_with(&BlockSpec::default(), face_outline, boundary, carved)
}

/// `buildable` with an explicit spec. The pieces are counter-clockwise with clockwise holes.
pub fn buildable_with(
    spec: &BlockSpec,
    face_outline: &Shape,
    boundary: &[BoundaryEdge],
    carved: &[Shape],
) -> Vec<Shape> {
    let face = normalized(face_outline.clone());
    if face.outer.len() < 3 {
        return Vec::new();
    }
    let paths: Vec<Path> = boundary.iter().flat_map(|e| paths_of(e, spec)).collect();
    let mut taken = cover(&paths, &links(&paths), spec.miter_limit);
    taken.extend(carved.iter().filter(|s| s.outer.len() >= 3).cloned());
    clean::cleaned(subtract(&face, &taken), spec)
}

/// The buildable land of a live face of `graph`, its boundary read from the face's walks and
/// its edges' classes at `clock`. Nothing for the unbounded face, a retired face, or a face
/// born after `clock`.
pub fn from_graph(graph: &Graph, face: FaceId, clock: Clock, spec: &BlockSpec) -> Vec<Shape> {
    let life = &graph.face(face).life;
    if !life.live() || !life.alive_at(clock) {
        return Vec::new();
    }
    let Some(outline) = graph.outline(face) else {
        return Vec::new();
    };
    // Each half of a walk has the face on its left; an edge with the face on both sides
    // appears twice, once per half.
    let boundary: Vec<BoundaryEdge> = graph
        .walks(face)
        .into_iter()
        .flatten()
        .map(|h| {
            let edge = graph.edge(h.edge());
            let n = edge.polyline.len();
            let mut polyline = edge.polyline.clone();
            let mut widths: Vec<f64> = (0..n)
                .map(|i| edge.widths.get(i).or(edge.widths.last()).copied().unwrap_or(0.0))
                .collect();
            if !h.is_forward() {
                polyline.reverse();
                widths.reverse();
            }
            BoundaryEdge {
                polyline,
                widths,
                class: *edge.class.at(clock).unwrap_or(edge.class.current()),
                side: Side::Left,
            }
        })
        .collect();
    buildable_with(spec, &outline, &boundary, &[])
}

/// The edge walked with the block on its left, once per side it faces.
fn paths_of(edge: &BoundaryEdge, spec: &BlockSpec) -> Vec<Path> {
    let n = edge.polyline.len();
    let half: Vec<f64> = (0..n)
        .map(|i| {
            let drawn = edge.widths.get(i).or(edge.widths.last()).copied().unwrap_or(0.0);
            spec.half_width(edge.class, drawn)
        })
        .collect();
    let forward = || Path::new(&edge.polyline, &half);
    let backward = || {
        let points: Vec<Point> = edge.polyline.iter().rev().copied().collect();
        let half: Vec<f64> = half.iter().rev().copied().collect();
        Path::new(&points, &half)
    };
    match edge.side {
        Side::Left => vec![forward()],
        Side::Right => vec![backward()],
        Side::Both => vec![forward(), backward()],
    }
}

/// `subject` minus the union of `clips`, in one overlay. Should the union fall back to its
/// overlapping inputs, which a single even-odd difference would partly cancel, the clips are
/// subtracted one at a time instead.
fn subtract(subject: &Shape, clips: &[Shape]) -> Vec<Shape> {
    if clips.is_empty() {
        return vec![subject.clone()];
    }
    let before = overlay_fallbacks();
    let merged = union(clips);
    if overlay_fallbacks() == before {
        return difference_many(subject, &merged);
    }
    clips.iter().fold(vec![subject.clone()], |pieces, clip| {
        pieces.iter().flat_map(|p| difference(p, clip)).collect()
    })
}
