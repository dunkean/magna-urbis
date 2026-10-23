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
use super::geometry as g;
use super::parcels::{FrontageIndex, network_contacts};
use super::programme::Demand;
use super::{
    Block, Enclosure, GrowthPhase, Layout, LayoutConfig, Parcel, ParcelAccess, ParcelOverride,
    Partition, Point, Quarter, QuarterOverride, Shape, Street, Surface,
};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

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
        deleted: None,
        salt: None,
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
    Ok(())
}
/// `deleted` is `merge` or `garden`; anything else is a malformed edit.
pub(super) fn validate_parcels(cfg: &super::ParcelConfig) -> Result<(), String> {
    for (id, o) in &cfg.overrides.parcels {
        if o.deleted
            .as_deref()
            .is_some_and(|d| !matches!(d, "merge" | "garden"))
        {
            return Err(format!(
                "Retouche parcelle {id} : suppression invalide (« merge » ou « garden »)"
            ));
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
/// A quarter keeps its own tissue (never borrows the donor's) only for a
/// morphology or role edit; a salt or a shape must not change it.
pub(super) fn keeps_own_tissue(cfg: &LayoutConfig, i: usize) -> bool {
    cfg.overrides
        .quarters
        .get(&i.to_string())
        .is_some_and(|o| !is_empty(&without_structure(o)))
}
/// The quarter was deleted by the user: it keeps its outline but owns no block.
pub fn quarter_removed(layout: &Layout, i: usize) -> bool {
    layout
        .config
        .as_ref()
        .and_then(|c| c.overrides.quarters.get(&i.to_string()))
        .is_some_and(|o| o.deleted == Some(true))
}

/// Config without any structural field (empty entries dropped): `L0`.
fn stripped(cfg: &LayoutConfig) -> LayoutConfig {
    let mut c = cfg.clone();
    c.overrides.quarters = cfg
        .overrides
        .quarters
        .iter()
        .map(|(k, o)| (k.clone(), without_structure(o)))
        .filter(|(_, o)| !is_empty(o))
        .collect();
    c
}
/// Config of the variant plan `L1`: salts and shapes kept, deletions dropped.
fn variant(cfg: &LayoutConfig) -> LayoutConfig {
    let mut c = cfg.clone();
    c.overrides.quarters = cfg
        .overrides
        .quarters
        .iter()
        .map(|(k, o)| {
            (
                k.clone(),
                if o.deleted == Some(true) {
                    without_structure(o)
                } else {
                    o.clone()
                },
            )
        })
        .filter(|(_, o)| !is_empty(o))
        .collect();
    c
}

// ---------------------------------------------------------- quarter edits

#[derive(Clone, Copy, Debug, Default)]
struct QuarterEdit {
    deleted: bool,
    salt: bool,
    shape: bool,
}

/// The per-site layout pipeline with the quarter structural edits applied.
/// `plan(c)` lays out the site with config `c` (quarter stage, kind stamp,
/// access refinement); `finish(l)` summarizes and prepares the programme.
/// Without any structural field this is exactly `plan(cfg)` then `finish`.
pub(super) fn with_quarter_edits(
    cfg: &LayoutConfig,
    plan: impl Fn(&LayoutConfig) -> Result<Layout, String>,
    finish: impl Fn(&mut Layout) -> Result<(), String>,
) -> Result<Layout, String> {
    validate_quarters(cfg)?;
    if !cfg.overrides.quarters.values().any(structural) {
        let mut layout = plan(cfg)?;
        finish(&mut layout)?;
        return Ok(layout);
    }
    let tick = std::time::Instant::now();
    let mut warnings = vec![];
    let mut l0 = plan(&stripped(cfg))?;
    let mut edits: BTreeMap<usize, QuarterEdit> = BTreeMap::new();
    for (k, o) in cfg.overrides.quarters.iter().filter(|(_, o)| structural(o)) {
        match k.parse::<usize>() {
            Ok(i) if i < l0.quarters.len() => {
                edits.insert(
                    i,
                    QuarterEdit {
                        deleted: o.deleted == Some(true),
                        salt: salt_of(o).is_some(),
                        shape: o.shape.is_some(),
                    },
                );
            }
            _ => warnings.push(format!("Retouche Q{k} : quartier introuvable, ignorée")),
        }
    }
    let l1 = if edits.values().any(|e| !e.deleted && (e.salt || e.shape)) {
        Some(plan(&variant(cfg))?)
    } else {
        None
    };
    // The variant plan's own verdicts on the outlines (« forme ignorée … »).
    if let Some(l1) = &l1 {
        warnings.extend(
            l1.warnings
                .iter()
                .filter(|w| w.starts_with("Retouche Q"))
                .cloned(),
        );
    }
    let Splice {
        layout: mut spliced,
        origin,
        streets,
        edited,
    } = splice(&l0, l1.as_ref(), &edits, &mut warnings);
    spliced.programme = None;
    let kinds: Vec<String> = spliced.blocks.iter().map(|b| b.kind.clone()).collect();
    finish(&mut spliced)?;
    finish(&mut l0)?;
    freeze(&mut spliced, &l0, &origin, &streets, &kinds, &mut warnings);
    spliced.warnings.extend(warnings);
    // The parcel stage reads the salts and deletions.
    if let Some(c) = spliced.config.as_mut() {
        c.overrides = cfg.overrides.clone();
    }
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  edits.quarters: {:.0} ms ({} edited)",
            tick.elapsed().as_secs_f64() * 1000.0,
            edited.len()
        );
    }
    Ok(spliced)
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
fn same_phase(a: &GrowthPhase, b: &GrowthPhase) -> bool {
    a.culture == b.culture && a.kind == b.kind && a.recipe == b.recipe && a.zone == b.zone
}
fn blocks_signature(l: &Layout, i: usize) -> Vec<String> {
    l.blocks
        .iter()
        .filter(|b| b.quarter == i)
        .map(|b| serde_json::to_string(&b.shape).unwrap_or_default())
        .collect()
}

struct Splice {
    layout: Layout,
    /// `L0` index of every block taken unchanged (`None`: a new block).
    origin: Vec<Option<usize>>,
    /// Index in the splice of every `L0` street (`None`: removed).
    streets: Vec<Option<usize>>,
    /// Quarters whose content changed.
    edited: BTreeSet<usize>,
}
/// The splice of `L0` and `L1` (section b.1). A kept block keeps every street
/// it fronts and gains none, so its lot contacts are unchanged by construction.
fn splice(
    l0: &Layout,
    l1: Option<&Layout>,
    edits: &BTreeMap<usize, QuarterEdit>,
    warnings: &mut Vec<String>,
) -> Splice {
    let mut s = l0.clone();
    // Final outline of every quarter whose content comes from `L1`.
    let mut redrawn: BTreeMap<usize, Shape> = BTreeMap::new();
    let mut deleted: BTreeSet<usize> = BTreeSet::new();
    for (&i, e) in edits {
        if e.deleted {
            deleted.insert(i);
            continue;
        }
        let Some(l1) = l1 else { continue };
        let (Some(q0), Some(q1)) = (l0.quarters.get(i), l1.quarters.get(i)) else {
            warnings.push(format!("Retouche Q{i} : quartier absent du nouveau tirage"));
            continue;
        };
        let (a0, a1) = (g::area(&q0.shape), g::area(&q1.shape));
        let reshaped = e.shape && q1.shape != q0.shape;
        if !reshaped && (a1 - a0).abs() > 0.01 * a0.max(1.0) {
            warnings.push(format!(
                "Retouche Q{i} : tirage impossible (quartier instable entre deux tracés)"
            ));
            continue;
        }
        // Never silent: a shape the variant plan did not apply says so.
        let prefix = format!("Retouche Q{i} :");
        if e.shape && !reshaped && !warnings.iter().any(|w| w.starts_with(&prefix)) {
            warnings.push(format!("{prefix} forme ignorée (sans effet sur le plan)"));
        }
        if !reshaped && !e.salt {
            continue;
        }
        // The edited quarter wins over its neighbours (the variant plan already
        // cut them, `reshape_quarters`); the final outline is the variant's.
        let shape = if reshaped {
            q1.shape.clone()
        } else {
            q0.shape.clone()
        };
        redrawn.insert(i, shape);
    }
    let touched: BTreeSet<usize> = redrawn.keys().chain(&deleted).copied().collect();
    // Kept blocks: every block of an untouched quarter, as in `L0`, except
    // where a reshaped quarter took its land: such a block is clipped by the
    // new outline (its pieces are new blocks of the same quarter).
    let reshaped_boxes = with_boxes(
        redrawn
            .iter()
            .filter(|(i, s)| **s != l0.quarters[**i].shape)
            .map(|(_, s)| s.clone())
            .collect(),
    );
    let mut clipped: BTreeMap<usize, Vec<Shape>> = BTreeMap::new();
    for (k, b) in l0.blocks.iter().enumerate() {
        if touched.contains(&b.quarter) {
            continue;
        }
        let bb = g::bbox(&b.shape);
        let hit: f64 = reshaped_boxes
            .iter()
            .filter(|(_, rb)| bbox_hit(bb, *rb, 0.0))
            .map(|(r, _)| overlap_area(std::slice::from_ref(&b.shape), r))
            .sum();
        if hit > 0.01 {
            clipped.insert(
                k,
                subtract(vec![b.shape.clone()], &reshaped_boxes)
                    .into_iter()
                    .filter(|p| g::area(p) > 1.0)
                    .map(clean)
                    .collect(),
            );
        }
    }
    for (&i, _) in redrawn.iter() {
        let n = clipped
            .keys()
            .filter(|&&k| bbox_hit(g::bbox(&l0.blocks[k].shape), g::bbox(&redrawn[&i]), 0.0))
            .count();
        if n > 0 && redrawn[&i] != l0.quarters[i].shape {
            warnings.push(format!(
                "Retouche Q{i} : {n} îlot(s) des quartiers voisins rogné(s) par la nouvelle forme"
            ));
        }
    }
    let kept: Vec<&Shape> = l0
        .blocks
        .iter()
        .enumerate()
        .filter(|(k, b)| !touched.contains(&b.quarter) && !clipped.contains_key(k))
        .map(|(_, b)| &b.shape)
        .chain(clipped.values().flatten())
        .collect();
    // Streets: `L0` order; local streets of a redrawn quarter go, and those of
    // a deleted quarter that no kept block fronts any more. Main streets stay.
    let near_kept = |shape: &Shape| -> Vec<&Shape> {
        let qb = g::bbox(shape);
        kept.iter()
            .copied()
            .filter(|b| bbox_hit(g::bbox(b), qb, 30.0))
            .collect()
    };
    let inner: Vec<usize> = (0..l0.streets.len())
        .filter(|&k| {
            touched
                .iter()
                .any(|&i| internal(&l0.streets[k], &l0.quarters[i].shape))
        })
        .collect();
    let neighbours: Vec<&Shape> = {
        let mut seen = BTreeSet::new();
        touched
            .iter()
            .flat_map(|&i| near_kept(&l0.quarters[i].shape))
            .filter(|b| seen.insert(*b as *const Shape))
            .collect()
    };
    let still_fronted = fronted(
        &inner.iter().map(|&k| &l0.streets[k]).collect::<Vec<_>>(),
        &neighbours,
    );
    let removed: BTreeSet<usize> = inner
        .iter()
        .zip(&still_fronted)
        .filter(|(_, f)| !**f)
        .map(|(k, _)| *k)
        .collect();
    let mut streets: Vec<Street> = vec![];
    let mut street_map = vec![None; l0.streets.len()];
    for (k, st) in l0.streets.iter().enumerate() {
        if removed.contains(&k) {
            continue;
        }
        street_map[k] = Some(streets.len());
        streets.push(st.clone());
    }
    let dropped = removed.len();
    let base_count = streets.len();
    if let Some(l1) = l1 {
        for (&i, _) in &redrawn {
            let q1 = &l1.quarters[i].shape;
            let foreign: Vec<&Shape> = kept
                .iter()
                .copied()
                .filter(|b| bbox_hit(g::bbox(b), g::bbox(q1), 20.0))
                .collect();
            let fresh: Vec<&Street> = l1
                .streets
                .iter()
                .filter(|st| internal(st, q1) && !duplicate(st, &streets[..base_count]))
                .collect();
            let fronts_kept = fronted(&fresh, &near_kept(q1));
            let skipped = fronts_kept.iter().filter(|f| **f).count();
            for st in fresh
                .into_iter()
                .zip(fronts_kept)
                .filter(|(_, f)| !*f)
                .map(|(st, _)| st)
            {
                // Correct by construction: a new street never cuts a kept block.
                let ribbon = g::ribbon(&st.path, &st.widths);
                let intrusion: f64 = foreign.iter().map(|b| overlap_area(&ribbon, b)).sum();
                if intrusion > 0.5 {
                    warnings.push(format!(
                        "Retouche Q{i} : une rue du nouveau tracé empiétait sur un îlot voisin, retirée"
                    ));
                    continue;
                }
                streets.push(st.clone());
            }
            if skipped > 0 {
                warnings.push(format!(
                    "Retouche Q{i} : {skipped} rue(s) du nouveau tracé longeant un îlot voisin, retirée(s)"
                ));
            }
        }
    }
    s.streets = streets;
    // New blocks of the redrawn quarters, clipped by their final outline, every
    // street and wall ribbon, and the kept blocks.
    let mut new_blocks: BTreeMap<usize, Vec<Block>> = BTreeMap::new();
    if let Some(l1) = l1 {
        let phase_map: Vec<Option<usize>> = l1
            .phases
            .iter()
            .map(|p| l0.phases.iter().position(|q| same_phase(p, q)))
            .collect();
        for (&i, shape) in &redrawn {
            let qb = g::bbox(shape);
            let mut cutters = with_boxes(
                s.streets
                    .iter()
                    .filter(|st| bbox_hit(path_bbox(&st.path), qb, max_width(st)))
                    .flat_map(|st| g::ribbon(&st.path, &st.widths))
                    .chain(
                        s.enclosures
                            .iter()
                            .filter(|e| bbox_hit(path_bbox(&e.path), qb, 3.0))
                            .flat_map(enclosure_ribbon),
                    )
                    .collect(),
            );
            cutters.extend(
                kept.iter()
                    .filter(|b| bbox_hit(g::bbox(b), qb, 0.0))
                    .map(|b| ((*b).clone(), g::bbox(b))),
            );
            let mut out = vec![];
            for b in l1.blocks.iter().filter(|b| b.quarter == i) {
                let pieces = subtract(g::intersection(&b.shape, shape), &cutters);
                for piece in pieces.into_iter().filter(|p| g::area(p) > 1.0) {
                    let mut kind = b.kind.clone();
                    if kind == "block" && !served(&piece, &s.streets) {
                        kind = "reserve".into();
                    }
                    out.push(Block {
                        shape: clean(piece),
                        quarter: i,
                        kind,
                        axis: b.axis,
                        zone: b.zone.clone(),
                        phase: b.phase.and_then(|p| phase_map.get(p).copied().flatten()),
                    });
                }
            }
            if out.is_empty() {
                warnings.push(format!(
                    "Retouche Q{i} : le nouveau tracé ne laisse aucun îlot constructible"
                ));
            }
            let before = blocks_signature(l0, i);
            let after: Vec<String> = out
                .iter()
                .map(|b| serde_json::to_string(&b.shape).unwrap_or_default())
                .collect();
            if before == after {
                warnings.push(format!(
                    "Retouche Q{i} : tirage sans effet sur les îlots (seules les parcelles changent)"
                ));
            }
            new_blocks.insert(i, out);
        }
    }
    let mut blocks = vec![];
    let mut origin = vec![];
    let mut placed = BTreeSet::new();
    for (k, b) in l0.blocks.iter().enumerate() {
        if !touched.contains(&b.quarter) {
            match clipped.get(&k) {
                None => {
                    blocks.push(b.clone());
                    origin.push(Some(k));
                }
                Some(pieces) => {
                    for piece in pieces {
                        let mut nb = b.clone();
                        nb.shape = piece.clone();
                        if nb.kind == "block" && !served(&nb.shape, &s.streets) {
                            nb.kind = "reserve".into();
                        }
                        blocks.push(nb);
                        origin.push(None);
                    }
                }
            }
            continue;
        }
        if placed.insert(b.quarter)
            && let Some(nb) = new_blocks.remove(&b.quarter)
        {
            origin.extend(std::iter::repeat_n(None, nb.len()));
            blocks.extend(nb);
        }
    }
    for (_, nb) in new_blocks {
        origin.extend(std::iter::repeat_n(None, nb.len()));
        blocks.extend(nb);
    }
    s.blocks = blocks;
    for (&i, shape) in &redrawn {
        s.quarters[i].shape = shape.clone();
    }
    // Neighbours give up the land a reshaped quarter took.
    for (j, q) in s.quarters.iter_mut().enumerate() {
        if redrawn.contains_key(&j) {
            continue;
        }
        let qb = g::bbox(&q.shape);
        if !reshaped_boxes.iter().any(|(r, rb)| {
            bbox_hit(qb, *rb, 0.0) && overlap_area(std::slice::from_ref(r), &q.shape) > 0.01
        }) {
            continue;
        }
        if let Some(rest) = largest(subtract(vec![q.shape.clone()], &reshaped_boxes)) {
            q.shape = clean(rest);
        }
    }
    if dropped > 0 && !deleted.is_empty() {
        warnings.push(format!(
            "Retouche : {} quartier(s) supprimé(s), {dropped} rue(s) locale(s) retirée(s)",
            deleted.len()
        ));
    }
    Splice {
        layout: s,
        origin,
        streets: street_map,
        edited: touched,
    }
}

/// The untouched part keeps `L0`'s inputs of the lot cut: road pressure,
/// block kind and reservation per kept block, district role, wealth and label.
/// A service reserved in a kept block stays there. A service displaced from an
/// edited quarter takes the splice programme's choice when it is a new block;
/// otherwise it stays in its quarter, on the new block most like its old one
/// (same kind, most overlap, then area) that fronts a street. Only a service
/// whose quarter has no such block left (deleted) is sited on lots.
fn freeze(
    s: &mut Layout,
    l0: &Layout,
    origin: &[Option<usize>],
    street_map: &[Option<usize>],
    kinds: &[String],
    warnings: &mut Vec<String>,
) {
    let mut kept_at = vec![None; l0.blocks.len()];
    for (b, k) in origin.iter().enumerate() {
        if let Some(k) = k {
            kept_at[*k] = Some(b);
        }
    }
    if let (true, Some(p0)) = (s.programme.is_some(), l0.programme.as_ref()) {
        let mut ps = s.programme.take().unwrap();
        for e in &mut ps.environment {
            if let Some(Some(k)) = origin.get(e.block)
                && let Some(e0) = p0.environment.get(*k).filter(|e0| e0.block == *k)
            {
                e.pressure = e0.pressure;
            }
        }
        let retag = |r: &super::programme::Reservation, b: usize| match r.id.rsplit_once('/') {
            Some((head, _)) => format!("{head}/{b}"),
            None => r.id.clone(),
        };
        let mut reservations = vec![];
        let mut placed = BTreeSet::new();
        let mut lost = vec![];
        for r in &p0.reservations {
            match (
                kept_at.get(r.block).copied().flatten(),
                street_map.get(r.street),
            ) {
                (Some(b), Some(Some(street))) => {
                    let mut r2 = r.clone();
                    r2.id = retag(r, b);
                    r2.block = b;
                    r2.street = *street;
                    placed.insert(r.demand_id.clone());
                    reservations.push(r2);
                }
                _ => lost.push(r),
            }
        }
        // The splice programme's own sites of displaced services, on new blocks.
        let mut resited: Vec<String> = vec![];
        for r in &ps.reservations {
            if origin.get(r.block).is_some_and(Option::is_none)
                && !placed.contains(&r.demand_id)
                && lost.iter().any(|l| l.demand_id == r.demand_id)
            {
                resited.push(r.demand_id.clone());
                reservations.push(r.clone());
            }
        }
        let mut reserved: BTreeSet<usize> = reservations.iter().map(|r| r.block).collect();
        let mut fallback = vec![];
        let mut displaced = 0usize;
        for r in lost {
            if let Some(k) = resited.iter().position(|d| *d == r.demand_id) {
                resited.remove(k);
                continue;
            }
            let Some(b0) = l0.blocks.get(r.block) else {
                displaced += 1;
                continue;
            };
            let best = s
                .blocks
                .iter()
                .enumerate()
                .filter(|(b, nb)| {
                    origin[*b].is_none() && nb.quarter == b0.quarter && !reserved.contains(b)
                })
                .filter_map(|(b, nb)| {
                    let contacts = super::parcels::block_contacts(&nb.shape, s);
                    let street = contacts
                        .iter()
                        .max_by(|x, y| {
                            x.length
                                .total_cmp(&y.length)
                                .then_with(|| y.street.cmp(&x.street))
                        })?
                        .street;
                    Some((
                        b,
                        street,
                        super::parcels::continuous_frontage(&contacts),
                        nb.kind == b0.kind,
                        overlap_area(std::slice::from_ref(&nb.shape), &b0.shape),
                        g::area(&nb.shape),
                    ))
                })
                .max_by(|x, y| {
                    x.3.cmp(&y.3)
                        .then(x.4.total_cmp(&y.4))
                        .then(x.5.total_cmp(&y.5))
                        .then(y.0.cmp(&x.0))
                });
            let Some((b, street, frontage, ..)) = best else {
                displaced += 1;
                continue;
            };
            reserved.insert(b);
            fallback.push(b);
            let mut r2 = r.clone();
            r2.id = retag(r, b);
            r2.block = b;
            r2.street = street;
            r2.frontage = frontage;
            r2.shape = s.blocks[b].shape.clone();
            reservations.push(r2);
        }
        for (b, block) in s.blocks.iter_mut().enumerate() {
            match origin[b] {
                Some(k) => block.kind = l0.blocks[k].kind.clone(),
                None if !reserved.contains(&b) => block.kind = kinds[b].clone(),
                None => {}
            }
        }
        for b in fallback {
            if s.blocks[b].kind == "block" {
                s.blocks[b].kind = "reserve:programme".into();
            }
        }
        ps.reservations = reservations;
        s.programme = Some(ps);
        if displaced > 0 {
            warnings.push(format!(
                "Retouche : {displaced} service(s) sans îlot réservé, placé(s) sur des parcelles"
            ));
        }
        if let Some(st) = s.structure.as_mut() {
            st.metrics.reserved_area = s
                .blocks
                .iter()
                .filter(|b| b.kind != "block")
                .map(|b| g::area(&b.shape))
                .sum();
        }
    }
    let edited: BTreeSet<usize> = s
        .blocks
        .iter()
        .zip(origin)
        .filter(|(_, o)| o.is_none())
        .map(|(b, _)| b.quarter)
        .chain(
            l0.blocks
                .iter()
                .enumerate()
                .filter(|(k, _)| kept_at[*k].is_none())
                .map(|(_, b)| b.quarter),
        )
        .collect();
    if let (Some(ss), Some(s0)) = (s.structure.as_mut(), l0.structure.as_ref())
        && ss.districts.len() == s0.districts.len()
    {
        for (d, d0) in ss.districts.iter_mut().zip(&s0.districts) {
            if d.quarters == d0.quarters && !d.quarters.iter().any(|q| edited.contains(q)) {
                d.role = d0.role.clone();
                d.wealth = d0.wealth;
                d.label = d0.label.clone();
            }
        }
    }
}

/// Hook of the quarter stage (variant plan only, after the composition): the
/// user outline of a quarter. Only what the user really moved counts: the
/// pieces between the user outline and the current one that reach farther
/// than `QUARTER_TOLERANCE` from it (`redraw`). The gain
/// is clipped to dry land; the edited quarter wins over its neighbours, which
/// give up the overlap. Streets and walls are carved out of its blocks later,
/// like everywhere else. Every refusal is a « forme ignorée » warning.
#[allow(clippy::too_many_arguments)]
pub(super) fn reshape_quarters(
    quarters: &mut [Quarter],
    phases: &mut [GrowthPhase],
    _streets: &[Street],
    _enclosures: &[Enclosure],
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    center: Point,
    radius: f64,
    warnings: &mut Vec<String>,
) {
    for (k, o) in &cfg.overrides.quarters {
        let (Some(user), false) = (&o.shape, o.deleted == Some(true)) else {
            continue;
        };
        let Some(i) = k.parse::<usize>().ok().filter(|&i| i < quarters.len()) else {
            continue;
        };
        if !valid_shape(user) {
            continue;
        }
        let old = quarters[i].shape.clone();
        let old_area = g::area(&old);
        let ignore = |why: &str, warnings: &mut Vec<String>| {
            warnings.push(format!("Retouche Q{i} : forme ignorée ({why})"));
        };
        let Some(valid) = largest(g::union(&[g::normalized(Shape {
            outer: user.outer.clone(),
            holes: vec![],
        })])) else {
            ignore("contour dégénéré", warnings);
            continue;
        };
        if overlap_area(std::slice::from_ref(&valid), &old) < 0.1 * old_area {
            ignore("ne recouvre plus le quartier", warnings);
            continue;
        }
        let Some(Outline {
            shape,
            gains,
            leftovers: _,
        }) = redraw(&old, &valid, QUARTER_TOLERANCE, |p| {
            g::dry_clip(&surface, p)
        })
        else {
            ignore("identique à la forme actuelle", warnings);
            continue;
        };
        let Some(shape) = shape else {
            ignore("rien ne reste après découpe", warnings);
            continue;
        };
        if moved_area(&shape, &old) < 1.0 {
            // Every gain fell in the water (or the overlay could not merge it).
            ignore(
                "sans effet : le gain est dans l'eau ou hors du site",
                warnings,
            );
            continue;
        }
        let area = g::area(&shape);
        let overlap = overlap_area(std::slice::from_ref(&shape), &old);
        let far = shape
            .outer
            .iter()
            .any(|p| (p.x - center.x).hypot(p.y - center.y) > 2.0 * radius.max(100.0));
        if area < 200.0 {
            ignore("moins de 200 m²", warnings);
            continue;
        } else if area > (4.0 * old_area).max(200_000.0) {
            ignore("trop grande", warnings);
            continue;
        } else if far {
            ignore("trop loin du centre", warnings);
            continue;
        } else if overlap < 0.1 * old_area {
            ignore("ne recouvre plus le quartier", warnings);
            continue;
        }
        // The neighbours give up the land taken (the gains only, so a
        // neighbour that only touches the quarter keeps its exact outline);
        // none may vanish.
        let cutter = with_boxes(gains.clone());
        let mut shrunk = vec![];
        let mut swallowed = false;
        for (j, q) in quarters.iter().enumerate() {
            if j == i
                || !cutter
                    .iter()
                    .any(|(_, cb)| bbox_hit(g::bbox(&q.shape), *cb, 0.0))
                || overlap_area(&gains, &q.shape) <= 0.01
            {
                continue;
            }
            match largest(subtract(vec![q.shape.clone()], &cutter)) {
                Some(rest) if g::area(&rest) >= 200.0 => shrunk.push((j, clean(rest))),
                _ => swallowed = true,
            }
        }
        if swallowed {
            ignore("absorberait un quartier voisin entier", warnings);
            continue;
        }
        for (j, rest) in shrunk {
            quarters[j].shape = rest;
        }
        // The gained land joins the quarter's growth phase, so the block
        // to phase lookup keeps it.
        if let Some(p) = phases.get_mut(quarters[i].phase) {
            p.shapes
                .extend(gains.into_iter().filter(|s| g::area(s) > 1.0));
        }
        quarters[i].shape = shape;
    }
}

/// Area that differs between two outlines (both differences).
fn moved_area(a: &Shape, b: &Shape) -> f64 {
    g::difference(a, b)
        .iter()
        .chain(&g::difference(b, a))
        .map(g::area)
        .sum()
}
/// An outline edit resolved against the current outline `old`.
struct Outline {
    /// The new outline (`None`: nothing left after the cuts).
    shape: Option<Shape>,
    /// The land really taken outside `old` (what the neighbours give up).
    gains: Vec<Shape>,
    /// The land of `old` given away (what the neighbours receive).
    leftovers: Vec<Shape>,
}
/// Only what the user really moved counts: the pieces between the user
/// outline `valid` and `old` that reach farther than `tolerance` from `old`'s
/// boundary (editor rounding and simplification chords are not edits). The
/// outline is built from the robust union `old ∪ valid` minus the pieces that
/// do not count, so a gain that touches `old` is never left apart by the
/// overlay. `admit` clips a gain to the land it may take (dry land, block…).
/// `None` when nothing was moved.
fn redraw(
    old: &Shape,
    valid: &Shape,
    (min_area, tolerance): (f64, f64),
    admit: impl Fn(&Shape) -> Vec<Shape>,
) -> Option<Outline> {
    let (raw_gain, raw_loss) = (g::difference(valid, old), g::difference(old, valid));
    let (gained, noise): (Vec<Shape>, Vec<Shape>) = raw_gain
        .into_iter()
        .partition(|p| counts(old, p, min_area, tolerance));
    let lost = significant(old, raw_loss, min_area, tolerance);
    if gained.is_empty() && lost.is_empty() {
        return None;
    }
    let gains: Vec<Shape> = gained
        .iter()
        .flat_map(&admit)
        .filter(|p| g::area(p) >= min_area)
        .map(clean)
        .collect();
    // Gains not admitted are cut back out of the union, like the noise.
    let refused = subtract(gained, &with_boxes(gains.clone()));
    let cut = with_boxes(
        noise
            .into_iter()
            .chain(refused)
            .chain(lost.clone())
            .collect(),
    );
    let base = keeping(g::union(&[old.clone(), valid.clone()]), old)?;
    let mut pieces = subtract(vec![base], &cut);
    pieces.retain(|p| g::area(p) > 0.01);
    let kept = pieces
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| {
            overlap_area(std::slice::from_ref(*a), old)
                .total_cmp(&overlap_area(std::slice::from_ref(*b), old))
                .then(g::area(a).total_cmp(&g::area(b)))
        })
        .map(|(k, s)| (k, s.clone()));
    // A piece of `old` cut off from the kept outline is given away too.
    let mut leftovers = lost;
    for (k, p) in pieces.iter().enumerate() {
        if kept.as_ref().is_some_and(|(j, _)| *j != k) {
            leftovers.extend(g::intersection(p, old));
        }
    }
    let shape = kept.map(|(_, s)| clean(s));
    let gains = match &shape {
        Some(s) => gains
            .into_iter()
            .filter(|p| overlap_area(std::slice::from_ref(s), p) > 0.5 * g::area(p))
            .collect(),
        None => vec![],
    };
    Some(Outline {
        shape,
        gains,
        leftovers,
    })
}

// -------------------------------------------------------------- lot edits

/// Shared boundary length of two lots (collinear edge overlaps, 5 cm).
fn shared_length(a: &Shape, b: &Shape) -> f64 {
    shared_edges(a, b).iter().map(|e| e.0).sum()
}
/// Collinear edge overlaps of two lots within 5 cm: the overlap length and the
/// thin quad between the two edges (cut lots may leave sub-centimetre gaps).
fn shared_edges(a: &Shape, b: &Shape) -> Vec<(f64, Shape)> {
    let mut out = vec![];
    if !bbox_hit(g::bbox(a), g::bbox(b), 0.1) {
        return out;
    }
    let edges = |s: &Shape| -> Vec<(Point, Point)> {
        std::iter::once(&s.outer)
            .chain(&s.holes)
            .flat_map(|r| {
                r.iter()
                    .zip(r.iter().cycle().skip(1))
                    .take(r.len())
                    .map(|(&p, &q)| (p, q))
            })
            .collect()
    };
    let (ea, eb) = (edges(a), edges(b));
    for &(p, q) in &ea {
        let l = (q.x - p.x).hypot(q.y - p.y);
        if l < 1e-6 {
            continue;
        }
        let (ux, uy) = ((q.x - p.x) / l, (q.y - p.y) / l);
        for &(r, s) in &eb {
            if g::distance(r, p, q).0 > 0.05 && g::distance(s, p, q).0 > 0.05 {
                continue;
            }
            let off = |v: Point| ((v.x - p.x) * uy - (v.y - p.y) * ux).abs();
            if off(r) > 0.05 || off(s) > 0.05 {
                continue;
            }
            let t = |v: Point| (v.x - p.x) * ux + (v.y - p.y) * uy;
            let (t0, t1) = (t(r).min(t(s)).max(0.0), t(r).max(t(s)).min(l));
            if t1 - t0 <= 0.0 {
                continue;
            }
            let on_a = |t: f64| Point {
                x: p.x + ux * t,
                y: p.y + uy * t,
            };
            let on_b = |v: Point| g::distance(v, r, s).2;
            let (p0, p1) = (on_a(t0), on_a(t1));
            out.push((
                t1 - t0,
                g::normalized(Shape {
                    outer: vec![p0, p1, on_b(p1), on_b(p0)],
                    holes: vec![],
                }),
            ));
        }
    }
    out
}
/// Union of two adjacent lots as one polygon, the gaps along their shared
/// edges bridged; `None` when they do not form one piece.
fn single_union(a: &Shape, b: &Shape) -> Option<Shape> {
    let unite = |a: &Shape, b: &Shape| {
        let mut parts = vec![a.clone(), b.clone()];
        parts.extend(
            shared_edges(a, b)
                .into_iter()
                .map(|e| e.1)
                .filter(|q| g::area(q) > 1e-9),
        );
        let mut u = g::union(&parts);
        // One simple polygon only: a folded or self-touching union is refused
        // (the caller tries the next neighbour).
        (u.len() == 1).then(|| clean(u.remove(0))).filter(g::simple)
    };
    unite(a, b).or_else(|| {
        // Sides shared only to floating precision: snap each onto the other
        // (the lot stage's own repair), simple rings only.
        let a2 = snap_onto(a, b, 0.05);
        let b2 = snap_onto(b, &a2, 0.05);
        (g::simple(&a2) && g::simple(&b2))
            .then(|| unite(&a2, &b2))
            .flatten()
    })
}
/// `shape` with each vertex within `tolerance` of a side of `onto` moved onto it.
fn snap_onto(shape: &Shape, onto: &Shape, tolerance: f64) -> Shape {
    let sides: Vec<(Point, Point)> = std::iter::once(&onto.outer)
        .chain(&onto.holes)
        .flat_map(|r| (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()])))
        .collect();
    let snap = |p: Point| {
        sides
            .iter()
            .map(|&(a, b)| g::distance(p, a, b))
            .filter(|d| d.0 <= tolerance)
            .min_by(|x, y| x.0.total_cmp(&y.0))
            .map_or(p, |d| d.2)
    };
    Shape {
        outer: shape.outer.iter().map(|&p| snap(p)).collect(),
        holes: shape
            .holes
            .iter()
            .map(|r| r.iter().map(|&p| snap(p)).collect())
            .collect(),
    }
}
fn requalify(p: &mut Parcel, layout: &Layout, index: &FrontageIndex, tag: &str) {
    p.contacts = network_contacts(&p.shape, layout, index);
    let old = p
        .access
        .as_ref()
        .map_or("public", |a| a.kind.as_str())
        .to_owned();
    let best = p
        .contacts
        .iter()
        .min_by(|a, b| a.rank.cmp(&b.rank).then(b.length.total_cmp(&a.length)))
        .cloned();
    p.access = Some(match best {
        Some(c) => {
            p.front = Some([c.a, c.b]);
            p.rank = c.rank;
            ParcelAccess {
                kind: match old.as_str() {
                    "collective" | "reserved" => old,
                    _ => "public".into(),
                },
                street: Some(c.street),
                front_length: c.length,
            }
        }
        None => {
            p.front = None;
            p.rank = 99;
            ParcelAccess {
                kind: if old == "reserved" {
                    old
                } else {
                    "unserved".into()
                },
                street: None,
                front_length: 0.0,
            }
        }
    });
    p.envelope = None;
    if !p.provenance.iter().any(|t| t == tag) {
        p.provenance.push(tag.into());
    }
}
/// (covered, residual, overlap, unserved) of one block's lots, as in the cut.
fn block_metrics(block: &Shape, lots: &[&Parcel]) -> [f64; 4] {
    let shapes: Vec<Shape> = lots.iter().map(|p| p.shape.clone()).collect();
    let merged = g::union(&shapes);
    let actual: f64 = shapes.iter().map(g::area).sum();
    let union_area: f64 = merged.iter().map(g::area).sum();
    let coverage: f64 = merged
        .iter()
        .flat_map(|m| g::intersection(block, m))
        .map(|s| g::area(&s))
        .sum();
    let expected = g::area(block);
    [
        coverage,
        (expected - coverage).max(0.0) + (union_area - coverage).max(0.0),
        (actual - union_area).max(0.0),
        lots.iter()
            .filter(|p| p.access.as_ref().is_some_and(|a| a.kind == "unserved"))
            .map(|p| g::area(&p.shape))
            .sum(),
    ]
}

/// Smallest remainder kept as its own garden lot; a smaller piece that no
/// neighbour can take stays unallotted (residual), never a sliver lot.
const MIN_REMAINDER: f64 = 2.0;

fn lot_served(p: &Parcel) -> bool {
    p.access.as_ref().is_none_or(|a| a.kind != "unserved")
}
/// A lot that hosts a service or a public space (market place, reserved
/// block of the programme): deleting it would leave the service on a garden.
fn service_lot(p: &Parcel, layout: &Layout) -> bool {
    matches!(p.use_kind.as_str(), "place" | "reserve")
        || p.access.as_ref().is_some_and(|a| a.kind == "reserved")
        || layout
            .blocks
            .get(p.block)
            .is_some_and(|b| b.kind != "block")
}
/// Give `piece` to the first lot of `candidates` (longest shared edge, then
/// smallest id) whose union with it is one polygon; `None` when none can.
fn give(lots: &[Option<Parcel>], candidates: &[usize], piece: &Shape) -> Option<(usize, Shape)> {
    let mut ranked: Vec<(usize, f64, &str)> = candidates
        .iter()
        .filter_map(|&ni| lots[ni].as_ref().map(|p| (ni, p)))
        .map(|(ni, p)| (ni, shared_length(&p.shape, piece), p.id.as_str()))
        .filter(|c| c.1 > 0.05)
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.2.cmp(b.2)));
    ranked
        .into_iter()
        .find_map(|(ni, ..)| single_union(&lots[ni].as_ref()?.shape, piece).map(|u| (ni, clean(u))))
}

/// Hook of the parcel stage, between the lot cut and the programme: lot
/// shapes first, then deletions, each in id order. Every edit is all or
/// nothing: it is tried on a copy and kept only when the block stays an exact
/// partition in which every served lot stays served.
pub(super) fn apply_parcel_edits(layout: &Layout, partition: &mut Partition) {
    let Some(cfg) = partition.config.as_ref() else {
        return;
    };
    let edits: Vec<(String, ParcelOverride)> = cfg
        .overrides
        .parcels
        .iter()
        .filter(|(_, o)| o.shape.is_some() || o.deleted.is_some())
        .map(|(k, o)| (k.clone(), o.clone()))
        .collect();
    if edits.is_empty() {
        return;
    }
    let index = FrontageIndex::new(layout);
    let mut lots: Vec<Option<Parcel>> = std::mem::take(&mut partition.parcels)
        .into_iter()
        .map(Some)
        .collect();
    // Output order: a remainder lot follows the lot it came from.
    let mut order: Vec<(usize, usize)> = (0..lots.len()).map(|i| (i, 0)).collect();
    let mut warnings = vec![];
    let mut before: BTreeMap<usize, [f64; 4]> = BTreeMap::new();
    let mut protected: BTreeSet<String> = BTreeSet::new();
    let find = |lots: &[Option<Parcel>], id: &str| {
        lots.iter()
            .position(|p| p.as_ref().is_some_and(|p| p.id == id))
    };
    let metrics = |lots: &[Option<Parcel>], block: usize| {
        let all: Vec<&Parcel> = lots.iter().flatten().filter(|p| p.block == block).collect();
        layout
            .blocks
            .get(block)
            .map_or([0.0; 4], |b| block_metrics(&b.shape, &all))
    };
    for (id, o) in edits.iter().filter(|(_, o)| o.shape.is_some()) {
        let user = o.shape.as_ref().unwrap();
        let Some(ai) = find(&lots, id) else {
            warnings.push(format!(
                "Retouche parcelle {id} : introuvable (quartier modifié ?)"
            ));
            continue;
        };
        let bi = lots[ai].as_ref().unwrap().block;
        let Some(block) = layout.blocks.get(bi) else {
            continue;
        };
        let ignore = |why: &str, warnings: &mut Vec<String>| {
            warnings.push(format!("Retouche parcelle {id} : forme ignorée ({why})"));
        };
        if !valid_shape(user) {
            ignore("contour invalide", &mut warnings);
            continue;
        }
        let Some(valid) = largest(g::union(&[g::normalized(Shape {
            outer: user.outer.clone(),
            holes: vec![],
        })])) else {
            ignore("contour dégénéré", &mut warnings);
            continue;
        };
        let old = lots[ai].as_ref().unwrap().shape.clone();
        if overlap_area(std::slice::from_ref(&valid), &old) < 0.1 * g::area(&old) {
            ignore("ne recouvre plus la parcelle", &mut warnings);
            continue;
        }
        // Gains stay within the block and off the lots already edited.
        let guards = with_boxes(
            lots.iter()
                .flatten()
                .filter(|p| p.block == bi && p.id != *id && protected.contains(&p.id))
                .map(|p| p.shape.clone())
                .collect(),
        );
        let Some(Outline {
            shape,
            gains,
            leftovers,
        }) = redraw(&old, &valid, LOT_TOLERANCE, |p| {
            subtract(g::intersection(p, &block.shape), &guards)
        })
        else {
            ignore("identique à la forme actuelle", &mut warnings);
            continue;
        };
        let Some(shape) = shape.filter(|s| g::area(s) >= 4.0) else {
            ignore("hors de l'îlot ou trop petite", &mut warnings);
            continue;
        };
        if moved_area(&shape, &old) < 0.5 {
            ignore("sans effet dans l'îlot", &mut warnings);
            continue;
        }
        // Trial on a copy; only the block's lots change.
        let mut trial = lots.clone();
        let members: Vec<usize> = (0..trial.len())
            .filter(|&k| trial[k].as_ref().is_some_and(|p| p.block == bi))
            .collect();
        let cutter = with_boxes(gains.clone());
        // (piece, may join the edited lot): the user's leftovers never do.
        let mut remainder: Vec<(Shape, bool)> = leftovers.into_iter().map(|p| (p, false)).collect();
        let mut changed: BTreeSet<usize> = BTreeSet::new();
        let mut absorbed = vec![];
        for &ni in &members {
            let n = trial[ni].as_mut().unwrap();
            if ni == ai
                || !cutter
                    .iter()
                    .any(|(_, cb)| bbox_hit(g::bbox(&n.shape), *cb, 0.0))
                || overlap_area(&gains, &n.shape) < 1e-6
            {
                continue;
            }
            let mut rest = subtract(vec![n.shape.clone()], &cutter);
            rest.sort_by(|a, b| g::area(b).total_cmp(&g::area(a)));
            if rest.first().is_none_or(|s| g::area(s) < 1.0) {
                absorbed.push(n.id.clone());
                trial[ni] = None;
                continue;
            }
            n.shape = clean(rest.remove(0));
            remainder.extend(rest.into_iter().map(|p| (p, true)));
            changed.insert(ni);
        }
        trial[ai].as_mut().unwrap().shape = shape;
        changed.insert(ai);
        let prefix = format!("{id}/reste-");
        let existing = trial
            .iter()
            .flatten()
            .filter(|p| p.id.starts_with(&prefix))
            .count();
        let mut fresh: Vec<Parcel> = vec![];
        for (piece, to_self) in remainder {
            if g::area(&piece) <= 0.01 {
                continue;
            }
            let candidates: Vec<usize> = members
                .iter()
                .copied()
                .filter(|&ni| {
                    trial[ni].as_ref().is_some_and(|p| {
                        if ni == ai {
                            to_self
                        } else {
                            !protected.contains(&p.id)
                        }
                    })
                })
                .collect();
            if let Some((ni, union)) = give(&trial, &candidates, &piece) {
                trial[ni].as_mut().unwrap().shape = union;
                changed.insert(ni);
                continue;
            }
            if g::area(&piece) < MIN_REMAINDER {
                continue; // a sliver: unallotted, counted as residual
            }
            let source = trial[ai].as_ref().unwrap();
            let mut rest = source.clone();
            rest.id = format!("{prefix}{}", existing + fresh.len() + 1);
            rest.parent_ids = vec![source.id.clone()];
            rest.provenance = vec!["edit:remainder".into()];
            rest.use_kind = "garden".into();
            rest.reason = "user-remainder".into();
            rest.family = "garden".into();
            rest.shape = clean(piece);
            requalify(&mut rest, layout, &index, "edit:shape");
            fresh.push(rest);
        }
        for &ni in &changed {
            if let Some(p) = trial[ni].as_mut() {
                requalify(p, layout, &index, "edit:shape");
            }
        }
        // Access invariant: no served lot of the block loses its street.
        let cut_off = changed.iter().find(|&&ni| {
            lots[ni].as_ref().is_some_and(lot_served)
                && trial[ni].as_ref().is_some_and(|p| !lot_served(p))
        });
        if let Some(&ni) = cut_off {
            let who = lots[ni].as_ref().unwrap().id.clone();
            if ni == ai {
                ignore("elle perdrait sa desserte", &mut warnings);
            } else {
                ignore(
                    &format!("la parcelle {who} perdrait sa desserte"),
                    &mut warnings,
                );
            }
            continue;
        }
        for gone in absorbed {
            warnings.push(format!(
                "Retouche parcelle {id} : la parcelle {gone} est absorbée"
            ));
        }
        before.entry(bi).or_insert_with(|| metrics(&lots, bi));
        lots = trial;
        let (slot, rank) = order[ai];
        for (k, rest) in fresh.into_iter().enumerate() {
            lots.push(Some(rest));
            order.push((slot, rank + existing + k + 1));
        }
        protected.insert(id.clone());
    }
    for (id, o) in edits.iter().filter(|(_, o)| o.deleted.is_some()) {
        let Some(ai) = find(&lots, id) else {
            warnings.push(format!(
                "Retouche parcelle {id} : introuvable (quartier modifié ?)"
            ));
            continue;
        };
        let bi = lots[ai].as_ref().unwrap().block;
        if service_lot(lots[ai].as_ref().unwrap(), layout) {
            warnings.push(format!(
                "Retouche parcelle {id} : parcelle d'un service ou d'un espace public, suppression ignorée (retouchez le quartier)"
            ));
            continue;
        }
        before.entry(bi).or_insert_with(|| metrics(&lots, bi));
        if o.deleted.as_deref() == Some("merge") {
            // Plots first, then gardens; within each, `give`'s ranking: the
            // first neighbour forming one polygon with the lot absorbs it.
            let a = lots[ai].as_ref().unwrap().shape.clone();
            let neighbours = |kind: &str| -> Vec<usize> {
                (0..lots.len())
                    .filter(|&ni| {
                        ni != ai
                            && lots[ni]
                                .as_ref()
                                .is_some_and(|p| p.block == bi && p.use_kind == kind)
                    })
                    .collect()
            };
            let survivor = give(&lots, &neighbours("plot"), &a)
                .or_else(|| give(&lots, &neighbours("garden"), &a));
            if let Some((ni, union)) = survivor {
                let gone = lots[ai].take().unwrap();
                let s = lots[ni].as_mut().unwrap();
                s.shape = union;
                s.parent_ids.push(gone.id.clone());
                requalify(s, layout, &index, "edit:merged");
                continue;
            }
            warnings.push(format!(
                "Retouche parcelle {id} : aucune voisine pour la fusion, laissée en jardin"
            ));
        }
        let a = lots[ai].as_mut().unwrap();
        a.use_kind = "garden".into();
        a.reason = "user-open-space".into();
        a.family = "garden".into();
        if !a.provenance.iter().any(|t| t == "edit:garden") {
            a.provenance.push("edit:garden".into());
        }
    }
    let mut slots: Vec<((usize, usize), Parcel)> = order
        .into_iter()
        .zip(lots)
        .filter_map(|(k, p)| p.map(|p| (k, p)))
        .collect();
    slots.sort_by_key(|(k, _)| *k);
    partition.parcels = slots.into_iter().map(|(_, p)| p).collect();
    if let Some(d) = partition.diagnostics.as_mut() {
        for (bi, old) in before {
            let all: Vec<&Parcel> = partition.parcels.iter().filter(|p| p.block == bi).collect();
            let new = layout
                .blocks
                .get(bi)
                .map_or([0.0; 4], |b| block_metrics(&b.shape, &all));
            d.covered_area += new[0] - old[0];
            d.residual_area = (d.residual_area + new[1] - old[1]).max(0.0);
            d.overlap_area = (d.overlap_area + new[2] - old[2]).max(0.0);
            d.unserved_area = (d.unserved_area + new[3] - old[3]).max(0.0);
        }
    }
    partition.warnings.extend(warnings);
}

/// Gate of the programme's band 0: only an edit carrying a use (role,
/// function, households) or a salt forces the lot; a shape-only or deletion
/// edit forces nothing.
pub(super) fn sets_use(ov: &ParcelOverride) -> bool {
    ov.deleted.is_none()
        && (ov.role.is_some()
            || ov.function.is_some()
            || ov.households.is_some()
            || ov.salt.is_some_and(|s| s > 0))
}
/// A salt without a role draws one admissible use, by a hash of the lot id
/// and the salt, among the distinct (role, function) of the town's ordinary
/// demands; a role or function wins and the salt then only reseeds the house.
pub(super) fn forced_use<'a>(
    ov: &'a ParcelOverride,
    id: &str,
    demands: &[Demand],
    mut eligible: impl FnMut(usize) -> bool,
) -> Result<Cow<'a, ParcelOverride>, String> {
    let Some(salt) = ov
        .salt
        .filter(|&s| s > 0 && ov.role.is_none() && ov.function.is_none())
    else {
        return Ok(Cow::Borrowed(ov));
    };
    let mut options: Vec<(String, String)> = demands
        .iter()
        .enumerate()
        .filter(|(_, d)| {
            // Ordinary uses only: houses, shops, workshops, stores; never an
            // institution or a landmark.
            !d.landmark
                && !d.role.is_empty()
                && matches!(
                    d.function.as_str(),
                    "domestic" | "mixed" | "workshop" | "warehouse"
                )
        })
        .filter(|(di, _)| eligible(*di))
        .map(|(_, d)| (d.role.clone(), d.function.clone()))
        .collect();
    options.sort();
    options.dedup();
    if options.is_empty() {
        return Err(format!(
            "Retouche parcelle {id} : aucun usage admissible pour un nouveau tirage"
        ));
    }
    let (role, function) =
        options[(fnv(&format!("{id}#{salt}")) % options.len() as u64) as usize].clone();
    Ok(Cow::Owned(ParcelOverride {
        role: Some(role),
        function: Some(function),
        households: ov.households,
        ..Default::default()
    }))
}
/// House seed of a lot: a lot salt reseeds it; the building id never changes.
pub(super) fn building_seed(seed: &str, id: &str, partition: &Partition) -> String {
    match partition
        .config
        .as_ref()
        .and_then(|c| c.overrides.parcels.get(id))
        .and_then(|o| o.salt)
        .filter(|&s| s > 0)
    {
        Some(s) => format!("{seed}/{id}#s{s}"),
        None => format!("{seed}/{id}"),
    }
}

#[cfg(test)]
mod tests;
