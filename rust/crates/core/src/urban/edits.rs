//! Structural user edits of the City Bench inspector: « Modifier la forme »,
//! « Supprimer » and « Tirer au sort » on one quarter or one lot
//! (`_agents_blackboard/OPUS_EDITS_SPEC.md`).
//!
//! Quarter edits are applied by splicing, never in place: the unedited plan
//! `L0` (structural fields stripped, exactly the plain pipeline) and, for a
//! salt or a shape, a variant plan `L1` are laid out; the edited quarters take
//! their blocks and internal local streets from `L1`, everything else stays
//! `L0`'s. Spliced blocks are clipped by the final quarter shape, the final
//! street and wall ribbons and the kept blocks, so no overlap can arise. The
//! programme then runs on the splice, and the untouched blocks keep `L0`'s
//! road pressure and district roles, so their lots are cut from the same inputs.
//!
//! Lot edits are a post-pass on the partition, between the lot cut and the
//! programme: a reshaped lot takes land from its block neighbours and gives its
//! remainder to the neighbour sharing the longest edge; a deleted lot merges
//! into its best neighbour or stays as a garden. Ids never re-hash.
use crate::urban::warnings;
use super::geometry as g;
use super::parcels::{FrontageIndex, network_contacts};
use super::programme::Demand;
use super::{
    Block, Enclosure, GrowthPhase, Layout, LayoutConfig, Parcel, ParcelAccess, ParcelOverride,
    Partition, Point, Quarter, QuarterOverride, Shape, Street, Surface,
};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

mod quarter_splice;
use quarter_splice::stripped;
#[cfg(test)]
use quarter_splice::FreezeInputs;
pub(super) use quarter_splice::with_quarter_edits;
mod outlines;
pub(super) use outlines::reshape_quarters;
use outlines::{Outline, moved_area, redraw, shared_length, single_union};
mod parcel_edits;
#[cfg(test)]
use parcel_edits::{MIN_REMAINDER, service_lot};
pub(super) use parcel_edits::{apply_parcel_edits, building_seed, forced_use, sets_use};

pub(super) mod blocks;
pub(super) mod quarter_baseline;
pub(super) mod quarter_parts;

/// Vertex bounds of an edited outline (outer ring).
const MAX_VERTICES: usize = 512;
const MAX_COORDINATE: f64 = 1e6;
/// (minimum area m², distance m) for an outline difference to count as an
/// edit. The inspector sends quarter rings simplified by Douglas–Peucker at
/// ε ≤ 1.6 m and lot rings at ε = 0.1 m, rounded to 0.1 m: within these
/// tolerances an unmoved outline is never an edit.
const QUARTER_TOLERANCE: (f64, f64) = (1.0, 1.75);
const LOT_TOLERANCE: (f64, f64) = (0.5, 0.35);

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    })
}

// ---------------------------------------------------------------- contract

fn salt_of(o: &QuarterOverride) -> Option<u32> {
    o.salt.filter(|&s| s > 0)
}
fn structural(o: &QuarterOverride) -> bool {
    o.shape.is_some() || o.deleted == Some(true) || salt_of(o).is_some()
}
fn without_structure(o: &QuarterOverride) -> QuarterOverride {
    QuarterOverride {
        shape: None,
        parts: None,
        deleted: None,
        salt: None,
        deleted_parts: vec![],
        ..o.clone()
    }
}
fn is_empty(o: &QuarterOverride) -> bool {
    *o == QuarterOverride::default()
}
fn valid_shape(s: &Shape) -> bool {
    (3..=MAX_VERTICES).contains(&s.outer.len())
        && s.holes.len() <= 16
        && std::iter::once(&s.outer)
            .chain(&s.holes)
            .flatten()
            .all(|p| {
                p.x.is_finite()
                    && p.y.is_finite()
                    && p.x.abs() <= MAX_COORDINATE
                    && p.y.abs() <= MAX_COORDINATE
            })
}

/// Malformed quarter edits are refused (the UI withdraws them); impossible
/// but well-formed ones only warn.
pub(super) fn validate_quarters(cfg: &LayoutConfig) -> Result<(), String> {
    for o in cfg.overrides.quarters.values() {
        if o.shape.as_ref().is_some_and(|s| !valid_shape(s)) {
            return Err("Retouche de quartier invalide (forme)".into());
        }
    }
    quarter_parts::validate(cfg)
}
/// `deleted` is `merge` or `garden`; anything else is a malformed edit.
pub(super) fn validate_parcels(cfg: &super::ParcelConfig) -> Result<(), String> {
    blocks::validate(cfg)?;
    for (id, edit) in &cfg.overrides.blocks {
        if blocks::parse_key(id).is_none()
            || edit.density.is_some_and(|d| !d.is_finite() || !(0.1..=10.0).contains(&d))
            || edit.culture.as_deref().is_some_and(|c| super::culture::mapping(c).is_none())
            || edit.role.as_deref().is_some_and(|r| !r.is_empty() && r != "auto" && super::roles::role_function(r).is_none())
            || edit.operator.as_deref().is_some_and(|op| !matches!(op, "culture" | "strips" | "oriented" | "compact" | "inherited" | "courtyard" | "frontage" | "compound" | "wholeBlock" | "garden")) {
            return Err(format!("Réglages de l’îlot {id} invalides"));
        }
    }
    for (id, o) in &cfg.overrides.parcels {
        if o.deleted
            .as_deref()
            .is_some_and(|d| !matches!(d, "merge" | "garden"))
        {
            return Err(format!(
                "Retouche parcelle {id} : suppression invalide (« merge » ou « garden »)"
            ));
        }
        if o.parts.as_ref().is_some_and(|p| {
            o.shape.is_some() || !(2..=64).contains(&p.len()) || p.iter().any(|s| !valid_shape(s))
        }) {
            return Err(format!("Invalid lot edit {id} (parts)"));
        }
    }
    Ok(())
}

/// RNG fork label of a quarter cut: unchanged without a salt (no-op rule).
pub(super) fn quarter_fork(label: &str, i: usize, cfg: &LayoutConfig) -> String {
    match cfg.overrides.quarters.get(&i.to_string()).and_then(salt_of) {
        Some(s) => format!("{label}:{i}/salt:{s}"),
        None => format!("{label}:{i}"),
    }
}
/// RNG fork label of a block's lot cut: a salted quarter reshuffles its lots
/// even when its blocks keep their geometry.
pub(super) fn block_fork(label: &str, layout: &Layout, quarter: usize) -> String {
    match layout
        .config
        .as_ref()
        .and_then(|c| c.overrides.quarters.get(&quarter.to_string()))
        .and_then(salt_of)
    {
        Some(s) => format!("{label}#salt:{s}"),
        None => label.to_owned(),
    }
}
/// The edit without the fields only read after the plan (building culture,
/// house settings, zone): those never change a street or a block, so the V2
/// applies them to the quarter's lots and buildings on the retained plan.
fn plan_fields(o: &QuarterOverride) -> QuarterOverride {
    QuarterOverride {
        building_culture: None,
        house_config: None,
        zone: None,
        ..o.clone()
    }
}
/// The edit changes the plan (streets, blocks, districts, reservations).
pub(super) fn edits_plan(o: &QuarterOverride) -> bool {
    !is_empty(&plan_fields(o))
}
/// A quarter keeps its own tissue (never borrows the donor's) only for a
/// morphology or role edit; a salt or a shape must not change it, nor a
/// field read after the plan (`plan_fields`).
pub(super) fn keeps_own_tissue(cfg: &LayoutConfig, i: usize) -> bool {
    cfg.overrides
        .quarters
        .get(&i.to_string())
        .is_some_and(|o| !is_empty(&plan_fields(&without_structure(o))))
}
/// The quarter was deleted by the user: it keeps its outline but owns no block.
pub fn quarter_removed(layout: &Layout, i: usize) -> bool {
    layout
        .config
        .as_ref()
        .and_then(|c| c.overrides.quarters.get(&i.to_string()))
        .is_some_and(|o| o.deleted == Some(true))
}

fn bbox_hit(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64), pad: f64) -> bool {
    a.0 <= b.2 + pad && b.0 <= a.2 + pad && a.1 <= b.3 + pad && b.1 <= a.3 + pad
}
fn path_bbox(path: &[Point]) -> (f64, f64, f64, f64) {
    path.iter().fold(
        (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        |(a, b, c, d), p| (a.min(p.x), b.min(p.y), c.max(p.x), d.max(p.y)),
    )
}
fn boundary_distance(s: &Shape, p: Point) -> f64 {
    std::iter::once(&s.outer)
        .chain(&s.holes)
        .flat_map(|r| {
            r.iter()
                .zip(r.iter().cycle().skip(1))
                .take(r.len())
                .map(move |(&a, &b)| g::distance(p, a, b).0)
        })
        .fold(f64::INFINITY, f64::min)
}
/// Sample points every ~2 m along a path, each with the length it stands for.
fn samples(path: &[Point]) -> Vec<(Point, f64)> {
    let mut out = vec![];
    for w in path.windows(2) {
        let l = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
        if l < 1e-9 {
            continue;
        }
        let n = (l / 2.0).ceil().max(1.0) as usize;
        for k in 0..n {
            let t = (k as f64 + 0.5) / n as f64;
            out.push((
                Point {
                    x: w[0].x + (w[1].x - w[0].x) * t,
                    y: w[0].y + (w[1].y - w[0].y) * t,
                },
                l / n as f64,
            ));
        }
    }
    out
}
/// A local street of the quarter: secondary rank, not a crossing or a wall
/// lane, and at least 75 % of its length more than 1 m inside the outline (a
/// street on the quarter boundary is shared with the neighbour and stays).
fn internal(s: &Street, shape: &Shape) -> bool {
    if s.rank < 2
        || matches!(
            s.role.as_str(),
            "bridge" | "ford" | "causeway" | "boundary" | "wall-lane" | "regional"
        )
        || !bbox_hit(path_bbox(&s.path), g::bbox(shape), 0.0)
    {
        return false;
    }
    let pts = samples(&s.path);
    let total: f64 = pts.iter().map(|p| p.1).sum();
    let inside: f64 = pts
        .iter()
        .filter(|(p, _)| g::contains(shape, *p) && boundary_distance(shape, *p) > 1.0)
        .map(|p| p.1)
        .sum();
    total > 0.0 && inside >= 0.75 * total
}
fn street_reach(s: &Street, p: Point, extra: f64) -> bool {
    s.path.windows(2).enumerate().any(|(j, w)| {
        let half = s.widths.get(j).copied().unwrap_or(4.0).max(
            s.widths
                .get(j + 1)
                .copied()
                .unwrap_or(s.widths.get(j).copied().unwrap_or(4.0)),
        ) * 0.5;
        g::distance(p, w[0], w[1]).0 <= half + extra
    })
}
fn max_width(s: &Street) -> f64 {
    s.widths.iter().fold(0.0, |a: f64, &w| a.max(w))
}
/// A block fronts a street when one of its vertices lies within the street's
/// half-width plus 2 m (the quarter stage's rule).
fn served(b: &Shape, streets: &[Street]) -> bool {
    let bb = g::bbox(b);
    streets.iter().any(|s| {
        bbox_hit(path_bbox(&s.path), bb, max_width(s) * 0.5 + 2.0)
            && b.outer.iter().any(|&p| street_reach(s, p, 2.0))
    })
}
/// Candidate streets that a parcel contact of one of `blocks` would use (the
/// lot stage's own contact rule, on a layout holding only the candidates).
fn fronted(candidates: &[&Street], blocks: &[&Shape]) -> Vec<bool> {
    let mut out = vec![false; candidates.len()];
    if candidates.is_empty() || blocks.is_empty() {
        return out;
    }
    let mini = Layout {
        config: None,
        programme: None,
        key: String::new(),
        culture: String::new(),
        center: Point { x: 0.0, y: 0.0 },
        quarters: vec![],
        streets: candidates.iter().map(|s| (*s).clone()).collect(),
        blocks: vec![],
        warnings: vec![],
        enclosures: vec![],
        phases: vec![],
        archetype: String::new(),
        structure: None,
        claim: Default::default(),
    };
    let index = FrontageIndex::new(&mini);
    for b in blocks {
        for c in network_contacts(b, &mini, &index) {
            out[c.street] = true;
        }
    }
    out
}
fn duplicate(s: &Street, kept: &[Street]) -> bool {
    let bb = path_bbox(&s.path);
    let near: Vec<&Street> = kept
        .iter()
        .filter(|k| bbox_hit(path_bbox(&k.path), bb, 3.0))
        .collect();
    let pts = samples(&s.path);
    let total: f64 = pts.iter().map(|p| p.1).sum();
    let close: f64 = pts
        .iter()
        .filter(|(p, _)| {
            near.iter().any(|k| {
                k.path
                    .windows(2)
                    .any(|w| g::distance(*p, w[0], w[1]).0 <= 3.0)
            })
        })
        .map(|p| p.1)
        .sum();
    total > 0.0 && close >= 0.8 * total
}
fn enclosure_ribbon(e: &Enclosure) -> Vec<Shape> {
    g::ribbon(&e.path, &[if e.kind == "wall" { 3.0 } else { 1.5 }])
}
/// Subtract every shape of `cutters` (bbox-filtered) from `pieces`.
fn subtract(mut pieces: Vec<Shape>, cutters: &[(Shape, (f64, f64, f64, f64))]) -> Vec<Shape> {
    for (c, cb) in cutters {
        pieces = pieces
            .into_iter()
            .flat_map(|p| {
                if bbox_hit(g::bbox(&p), *cb, 0.0) {
                    g::difference(&p, c)
                } else {
                    vec![p]
                }
            })
            .collect();
        if pieces.is_empty() {
            break;
        }
    }
    pieces
}
fn with_boxes(shapes: Vec<Shape>) -> Vec<(Shape, (f64, f64, f64, f64))> {
    shapes
        .into_iter()
        .map(|s| {
            let b = g::bbox(&s);
            (s, b)
        })
        .collect()
}
fn overlap_area(a: &[Shape], b: &Shape) -> f64 {
    let bb = g::bbox(b);
    a.iter()
        .filter(|s| bbox_hit(g::bbox(s), bb, 0.0))
        .flat_map(|s| g::intersection(s, b))
        .map(|s| g::area(&s))
        .sum()
}
fn largest(shapes: Vec<Shape>) -> Option<Shape> {
    shapes
        .into_iter()
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
}
/// Valid output shape: consecutive duplicate vertices and the closing copy
/// dropped; holes of fewer than 3 vertices or without area dropped.
fn clean(mut s: Shape) -> Shape {
    let dedup = |r: &mut Vec<Point>| {
        r.dedup_by(|a, b| (a.x - b.x).abs() < 1e-9 && (a.y - b.y).abs() < 1e-9);
        while r.len() > 1
            && r.first()
                .zip(r.last())
                .is_some_and(|(a, b)| (a.x - b.x).abs() < 1e-9 && (a.y - b.y).abs() < 1e-9)
        {
            r.pop();
        }
    };
    dedup(&mut s.outer);
    for h in &mut s.holes {
        dedup(h);
    }
    s.holes
        .retain(|h| h.len() >= 3 && g::signed(h).abs() > 0.01);
    s
}
/// Pieces of a user delta against the current outline `old` that carry an
/// intent: at least `min_area`, and one vertex farther than `tolerance` from
/// `old`'s boundary. Slivers hugging the boundary are editor rounding (0.1 m)
/// or simplification, never a request.
fn significant(old: &Shape, pieces: Vec<Shape>, min_area: f64, tolerance: f64) -> Vec<Shape> {
    pieces
        .into_iter()
        .filter(|p| counts(old, p, min_area, tolerance))
        .collect()
}
/// A piece counts when it is at least `min_area` and one point of its
/// boundary (vertices, and points every `tolerance` metres along its edges)
/// lies farther than `tolerance` from `old`'s boundary: a strip whose corners
/// all sit on `old`'s edges still counts by its width.
fn counts(old: &Shape, p: &Shape, min_area: f64, tolerance: f64) -> bool {
    if g::area(p) < min_area {
        return false;
    }
    let step = tolerance.max(0.1);
    std::iter::once(&p.outer).chain(&p.holes).any(|r| {
        (0..r.len()).any(|i| {
            let (a, b) = (r[i], r[(i + 1) % r.len()]);
            let n = ((a.x - b.x).hypot(a.y - b.y) / step)
                .ceil()
                .clamp(1.0, 4096.0) as usize;
            (0..n).any(|k| {
                let t = k as f64 / n as f64;
                let q = Point {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                };
                boundary_distance(old, q) > tolerance
            })
        })
    })
}
/// The piece of `pieces` that keeps most of `old` (then the largest).
fn keeping(pieces: Vec<Shape>, old: &Shape) -> Option<Shape> {
    pieces.into_iter().max_by(|a, b| {
        overlap_area(std::slice::from_ref(a), old)
            .total_cmp(&overlap_area(std::slice::from_ref(b), old))
            .then(g::area(a).total_cmp(&g::area(b)))
    })
}
#[cfg(test)]
mod tests;
