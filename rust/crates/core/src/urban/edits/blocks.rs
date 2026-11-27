//! Structural block edits of the parcel stage: a new outline, a split into
//! closed parts, a deletion (`BlockOverride::{shape, parts, deleted}`).
//!
//! The edits are applied once to the actual layout geometry before the lots
//! are cut (`prepare`), so the parcels, the programme, the building sites and
//! the display all read the same blocks:
//! - a block keeps its index; a reshaped block or part 0 of a split block
//!   replaces it in place, parts 1.. are appended after the input blocks, so no
//!   index of an untouched block (programme reservations and environment
//!   included) ever moves;
//! - a deleted block stays in place with kind `deleted` and holds no lot;
//! - the new geometry is clipped to the block's quarter (plus its own former
//!   outline), the street and wall ribbons and every other block: neighbours
//!   are never reshaped, and parts never overlap (each part is cut out of the
//!   ones before it, so a cut never merges back);
//! - the prepared layout records what it replaced (`LayoutConfig::block_edits`):
//!   preparing it again first restores the input blocks, so a split is never
//!   applied twice and a removed edit is undone.
//!
//! Override keys: `"<i>"` addresses block `i` of the input layout (part 0 of a
//! split block), `"<i>/<k>"` part `k ≥ 1` of a split block `i`. A part key may
//! carry `deleted` and every non-structural setting; a part inherits the
//! settings of its source block unless it sets its own. The geometry of a part
//! is edited in the source's `parts[k]`.
use crate::urban::warnings;
use super::super::geometry as g;
use super::super::{
    Block, BlockEdits, BlockOrigin, BlockOverride, Layout, OriginalBlock, ParcelConfig, Shape,
};
use super::{
    Outline, bbox_hit, circuit_ground, clean, fnv, largest, max_width, overlap_area, path_bbox,
    redraw, served, subtract, valid_shape,
};
use std::borrow::Cow;
use std::collections::BTreeMap;

/// Kind of a block deleted by the user: it keeps its index and outline but
/// holds no lot; the land is open ground.
pub const DELETED: &str = "deleted";
/// (minimum area m², distance m) for a block outline difference to count as
/// an edit (the inspector rounds to 0.1 m).
const BLOCK_TOLERANCE: (f64, f64) = (1.0, 0.5);
/// Smallest block or part kept (m²).
const MIN_BLOCK: f64 = 20.0;
const MAX_PARTS: usize = 64;

type BBox = (f64, f64, f64, f64);

/// `"<i>"` → `(i, 0)`, `"<i>/<k>"` → `(i, k)` with `k ≥ 1`.
pub(crate) fn parse_key(key: &str) -> Option<(usize, usize)> {
    match key.split_once('/') {
        None => Some((key.parse().ok()?, 0)),
        Some((i, k)) => {
            let k: usize = k.parse().ok()?;
            (k >= 1).then_some(())?;
            Some((i.parse().ok()?, k))
        }
    }
}
fn structural(o: &BlockOverride) -> bool {
    o.shape.is_some() || o.parts.is_some() || o.deleted == Some(true) || !o.deleted_parts.is_empty()
}
fn settings(o: &BlockOverride) -> BlockOverride {
    BlockOverride {
        shape: None,
        parts: None,
        deleted: None,
        deleted_parts: vec![],
        ..o.clone()
    }
}
/// The part's own settings, the source's for the fields it leaves unset.
fn inherited(own: Option<&BlockOverride>, source: Option<&BlockOverride>) -> BlockOverride {
    let own = own.map(settings).unwrap_or_default();
    let Some(src) = source.map(settings) else { return own };
    BlockOverride {
        culture: own.culture.or(src.culture),
        role: own.role.or(src.role),
        density: own.density.or(src.density),
        operator: own.operator.or(src.operator),
        salt: own.salt.or(src.salt),
        house_config: own.house_config.or(src.house_config),
        shape: None,
        parts: None,
        deleted: None,
        deleted_parts: vec![],
    }
}

/// Malformed structural block edits are refused (the UI withdraws them).
pub(crate) fn validate(cfg: &ParcelConfig) -> Result<(), String> {
    for (id, o) in &cfg.overrides.blocks {
        let Some((_, part)) = parse_key(id) else {
            return Err(format!("Invalid block edit {id} (key)"));
        };
        let bad_shape = o.shape.as_ref().is_some_and(|s| !valid_shape(s));
        let bad_parts = o.parts.as_ref().is_some_and(|p| {
            !(2..=MAX_PARTS).contains(&p.len()) || p.iter().any(|s| !valid_shape(s))
        });
        let both = o.shape.is_some() && o.parts.is_some();
        let part_geometry = part > 0 && (o.shape.is_some() || o.parts.is_some() || !o.deleted_parts.is_empty());
        let bad_deleted = o.deleted_parts.iter().any(|&k| k >= o.parts.as_ref().map_or(1, Vec::len));
        if bad_shape || bad_parts || both || part_geometry || bad_deleted {
            return Err(format!("Invalid block edit {id} (shape or parts)"));
        }
    }
    Ok(())
}

/// Signature of a prepared block list: robust to coordinate rounding in
/// transit, distinct from any other plan of the same town in practice.
fn signature(blocks: &[Block]) -> String {
    let mut text = String::with_capacity(blocks.len() * 12);
    for b in blocks {
        text.push_str(&b.kind);
        text.push('|');
        text.push_str(&b.quarter.to_string());
        text.push(';');
    }
    format!("{}:{:016x}", blocks.len(), fnv(&text))
}
/// The input layout of a prepared one (`None`: not prepared).
pub(super) fn restore(layout: &Layout) -> Option<Layout> {
    let marker = layout.config.as_ref()?.block_edits.as_ref()?;
    let mut l = layout.clone();
    if let Some(c) = l.config.as_mut() {
        c.block_edits = None;
    }
    if marker.signature == signature(&layout.blocks)
        && marker.count <= l.blocks.len()
        && marker.originals.iter().all(|o| o.index < marker.count)
    {
        l.blocks.truncate(marker.count);
        for o in &marker.originals {
            l.blocks[o.index] = o.block.clone();
        }
    }
    Some(l)
}

/// The layout and parcel config the lot cut reads.
pub(crate) struct Prepared<'a> {
    pub layout: Cow<'a, Layout>,
    /// Block overrides keyed by prepared index, structural fields applied and dropped.
    pub config: Cow<'a, ParcelConfig>,
    pub warnings: Vec<String>,
}

/// Applies the structural block edits of `cfg` to `input` (restored first
/// when it was already prepared). Without any structural edit or part key,
/// an unprepared input and its config are returned as they are.
pub(crate) fn prepare<'a>(input: &'a Layout, cfg: &'a ParcelConfig) -> Prepared<'a> {
    let restored = restore(input);
    let edits = &cfg.overrides.blocks;
    let any = edits
        .iter()
        .any(|(k, o)| structural(o) || parse_key(k).is_some_and(|(_, p)| p > 0));
    if !any {
        return Prepared {
            layout: restored.map_or(Cow::Borrowed(input), Cow::Owned),
            config: Cow::Borrowed(cfg),
            warnings: vec![],
        };
    }
    let mut l = restored.unwrap_or_else(|| input.clone());
    let n = l.blocks.len();
    let mut warnings = vec![];
    let mut originals: Vec<OriginalBlock> = vec![];
    let mut origins: Vec<BlockOrigin> = vec![];
    let mut placed: BTreeMap<(usize, usize), usize> = (0..n).map(|i| ((i, 0), i)).collect();
    let mut sources: Vec<(usize, &BlockOverride)> = edits
        .iter()
        .filter(|(_, o)| structural(o))
        .filter_map(|(k, o)| match parse_key(k) {
            Some((i, 0)) => Some((i, o)),
            _ => None,
        })
        .collect();
    sources.sort_by_key(|s| s.0);
    for (i, o) in sources {
        let ignore = |why: &str, warnings: &mut Vec<String>| {
            warnings.push(warnings::block_edit_ignored(i, why));
        };
        let Some(old) = l.blocks.get(i).filter(|_| i < n).cloned() else {
            ignore("block not found", &mut warnings);
            continue;
        };
        let reserved = l
            .programme
            .as_ref()
            .is_some_and(|p| p.reservations.iter().any(|r| r.block == i));
        if !matches!(old.kind.as_str(), "block" | "reserve") || reserved {
            ignore("the block hosts a service or a public space", &mut warnings);
            continue;
        }
        if o.deleted == Some(true) {
            l.blocks[i].kind = DELETED.into();
            originals.push(OriginalBlock { index: i, block: old });
            origins.push(BlockOrigin { block: i, source: i, part: 0, deleted: true });
            continue;
        }
        let drawn: Vec<&Shape> = o.shape.iter().chain(o.parts.iter().flatten()).collect();
        let reach = drawn
            .iter()
            .map(|s| g::bbox(s))
            .fold(g::bbox(&old.shape), |a, b| (a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3)));
        let region = match l.quarters.get(old.quarter) {
            Some(q) => g::union(&[q.shape.clone(), old.shape.clone()]),
            None => vec![old.shape.clone()],
        };
        let blockers = obstacles(&l, i, reach);
        let result = match (&o.shape, &o.parts) {
            (_, Some(parts)) => split(&old.shape, parts, &region, &blockers),
            (Some(shape), None) => reshape(&old.shape, shape, &region, &blockers).map(|s| vec![s]),
            _ => continue,
        };
        let pieces = match result {
            Ok(p) => p,
            Err(why) => {
                ignore(why, &mut warnings);
                continue;
            }
        };
        for (k, piece) in pieces.into_iter().enumerate() {
            let mut b = old.clone();
            b.kind = (if served(&piece, &l.streets) { "block" } else { "reserve" }).to_owned();
            b.shape = piece;
            let at = if k == 0 {
                l.blocks[i] = b;
                i
            } else {
                l.blocks.push(b);
                l.blocks.len() - 1
            };
            placed.insert((i, k), at);
            let deleted = o.deleted_parts.contains(&k);
            if deleted { l.blocks[at].kind = DELETED.into(); }
            origins.push(BlockOrigin { block: at, source: i, part: k, deleted });
        }
        originals.push(OriginalBlock { index: i, block: old });
    }
    // Deleted parts of split blocks.
    for (k, _) in edits.iter().filter(|(_, o)| o.deleted == Some(true)) {
        let Some((i, p)) = parse_key(k).filter(|kp| kp.1 > 0) else { continue };
        match placed.get(&(i, p)) {
            Some(&at) => {
                l.blocks[at].kind = DELETED.into();
                if let Some(origin) = origins.iter_mut().find(|x| x.block == at) {
                    origin.deleted = true;
                }
            }
            None => warnings.push(warnings::block_part_missing(k)),
        }
    }
    for k in edits.keys() {
        if parse_key(k).is_some_and(|(i, p)| p > 0 && !placed.contains_key(&(i, p)))
            && edits[k].deleted != Some(true)
        {
            warnings.push(warnings::block_part_missing(k));
        }
    }
    // Settings keyed by prepared index; a part inherits its source's.
    let mut config = cfg.clone();
    config.overrides.blocks = placed
        .iter()
        .filter_map(|(&(i, p), &at)| {
            let own = edits.get(&if p == 0 { i.to_string() } else { format!("{i}/{p}") });
            let source = (p > 0).then(|| edits.get(&i.to_string())).flatten();
            let resolved = inherited(own, source);
            (resolved != BlockOverride::default()).then(|| (at.to_string(), resolved))
        })
        .collect();
    origins.sort_by_key(|o| o.block);
    originals.sort_by_key(|o| o.index);
    let marker = BlockEdits {
        count: n,
        signature: signature(&l.blocks),
        originals,
        origins,
    };
    l.config.get_or_insert_with(Default::default).block_edits = Some(marker);
    Prepared {
        layout: Cow::Owned(l),
        config: Cow::Owned(config),
        warnings,
    }
}

/// Street and wall ribbons and the other live blocks around `reach`.
fn obstacles(l: &Layout, own: usize, reach: BBox) -> Vec<(Shape, BBox)> {
    let pad = 2.0;
    let mut out: Vec<Shape> = l
        .streets
        .iter()
        .filter(|st| bbox_hit(path_bbox(&st.path), reach, max_width(st) + pad))
        .flat_map(|st| g::ribbon(&st.path, &st.widths))
        .chain(
            l.enclosures
                .iter()
                .flat_map(circuit_ground)
                .filter(|s| bbox_hit(g::bbox(s), reach, pad)),
        )
        .collect();
    out.extend(
        l.blocks
            .iter()
            .enumerate()
            .filter(|(j, b)| *j != own && b.kind != DELETED && bbox_hit(g::bbox(&b.shape), reach, pad))
            .map(|(_, b)| b.shape.clone()),
    );
    out.into_iter()
        .map(|s| {
            let b = g::bbox(&s);
            (s, b)
        })
        .collect()
}
/// `piece` within `region`, off every obstacle.
fn admit(piece: &Shape, region: &[Shape], obstacles: &[(Shape, BBox)]) -> Vec<Shape> {
    let inside: Vec<Shape> = region.iter().flat_map(|r| g::intersection(piece, r)).collect();
    subtract(inside, obstacles)
        .into_iter()
        .filter(|p| g::area(p) > 0.01)
        .collect()
}
fn outline(s: &Shape) -> Option<Shape> {
    largest(g::union(&[g::normalized(Shape {
        outer: s.outer.clone(),
        holes: vec![],
    })]))
}
/// New outline of a block: only what the user really moved counts (`redraw`).
fn reshape(
    old: &Shape,
    user: &Shape,
    region: &[Shape],
    obstacles: &[(Shape, BBox)],
) -> Result<Shape, &'static str> {
    let valid = outline(user).ok_or("degenerate outline")?;
    if overlap_area(std::slice::from_ref(&valid), old) < 0.1 * g::area(old) {
        return Err("no longer covers the block");
    }
    let Outline { shape, .. } = redraw(old, &valid, BLOCK_TOLERANCE, |p| admit(p, region, obstacles))
        .ok_or("same as the current outline")?;
    shape
        .filter(|s| g::area(s) >= MIN_BLOCK)
        .ok_or("nothing buildable left after clipping")
}
/// Closed parts of a split block, in order: each clipped like an outline and
/// cut out of the parts before it. All or nothing.
fn split(
    old: &Shape,
    parts: &[Shape],
    region: &[Shape],
    obstacles: &[(Shape, BBox)],
) -> Result<Vec<Shape>, &'static str> {
    let mut taken = obstacles.to_vec();
    let mut out = vec![];
    for part in parts {
        let valid = outline(part).ok_or("degenerate part")?;
        let piece = largest(admit(&valid, region, &taken))
            .filter(|s| g::area(s) >= MIN_BLOCK)
            .ok_or("a part is empty or too small after clipping")?;
        let piece = clean(piece);
        let bb = g::bbox(&piece);
        taken.push((piece.clone(), bb));
        out.push(piece);
    }
    if out.iter().all(|p| overlap_area(std::slice::from_ref(p), old) < 0.01) {
        return Err("the parts do not cover the block");
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
