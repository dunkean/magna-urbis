//! Quarter split (`QuarterOverride::parts`): a manual administrative / tissue
//! boundary drawn across one quarter. It never builds a road.
//!
//! - The plan itself never reads `parts` nor the part keys (`base`): the
//!   source quarter is generated exactly as without the split, ordinary
//!   shape/salt/deletion edits included (`parts` is exclusive with `shape`).
//! - `apply` is a post-pass on the finished layout of the quarter stage
//!   (`with_quarter_edits`), run once: each part is clipped to the source
//!   quarter and cut out of the parts before it; the source keeps index `i`
//!   for part 0, parts `k ≥ 1` are appended after the quarters of the plan in
//!   key order. Streets, phases, enclosures and every other quarter stay.
//! - The source's blocks are split along the parts: a block inside one part
//!   only changes its `quarter`; a cut block keeps its index for its largest
//!   piece and appends the others, so no other block index moves. Pieces under
//!   `MIN_PIECE` are dropped with a warning.
//! - Output-only `LayoutConfig::quarter_edits` maps every output quarter of a
//!   split to `(source, part)`; its edit key is `"<i>"` (part 0) or `"<i>/<k>"`.
//!
//! Override keys: `"<i>/<k>"` addresses part `k ≥ 1` of source quarter `i`. It
//! may carry `deleted` and every non-structural setting (never `shape`/`parts`:
//! the geometry of a part is edited in the source's `parts[k]`). A part
//! inherits its source's settings unless it sets its own: the resolved
//! settings are written under the part's output index in the output
//! `overrides.quarters`, so every later stage reads them like any quarter's.
use super::super::geometry as g;
use super::super::{
    Block, Layout, LayoutConfig, OriginalQuarter, Quarter, QuarterEdits, QuarterOverride,
    QuarterPart, Shape,
};
use super::blocks::{DELETED, parse_key};
use super::{bbox_hit, clean, largest, overlap_area, served, subtract};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

const MAX_PARTS: usize = 64;
/// Smallest part kept (m²): all or nothing.
const MIN_PART: f64 = 50.0;
/// Smallest block piece kept (m²); smaller pieces are dropped with a warning.
const MIN_PIECE: f64 = 1.0;
/// Share of the source quarter the drawn parts may leave uncovered (editor
/// simplification of the outline); the uncovered rest joins the adjacent part.
const COVER_TOLERANCE: f64 = 0.05;

type BBox = (f64, f64, f64, f64);

fn child(key: &str) -> bool {
    key.contains('/')
}

/// Malformed split edits are refused (the UI withdraws them).
pub(super) fn validate(cfg: &LayoutConfig) -> Result<(), String> {
    for (k, o) in &cfg.overrides.quarters {
        let part_key = child(k);
        if part_key && parse_key(k).is_none_or(|(_, p)| p == 0) {
            return Err(format!("Invalid quarter edit {k} (key)"));
        }
        let bad_parts = o.parts.as_ref().is_some_and(|p| {
            !(2..=MAX_PARTS).contains(&p.len()) || p.iter().any(|s| !super::valid_shape(s))
        });
        let both = o.parts.is_some() && o.shape.is_some();
        let part_geometry = part_key && (o.shape.is_some() || o.parts.is_some());
        let bad_deleted = o.deleted_parts.iter().any(|&k| k >= o.parts.as_ref().map_or(1, Vec::len));
        if bad_parts || both || part_geometry || bad_deleted || part_key && !o.deleted_parts.is_empty() {
            return Err(format!("Invalid quarter edit {k} (shape or parts)"));
        }
    }
    Ok(())
}

/// The config the plan reads: no `parts`, no part key, no output record, and
/// none of the resolved part settings a previous `apply` wrote (an output
/// config sent back as an input). Borrowed unchanged when there is none of them.
pub(super) fn base(cfg: &LayoutConfig) -> Cow<'_, LayoutConfig> {
    let dirty = cfg.quarter_edits.is_some()
        || cfg
            .overrides
            .quarters
            .iter()
            .any(|(k, o)| child(k) || o.parts.is_some());
    if !dirty {
        return Cow::Borrowed(cfg);
    }
    let resolved: BTreeSet<String> = cfg
        .quarter_edits
        .iter()
        .flat_map(|r| &r.parts)
        .filter(|p| p.part > 0)
        .map(|p| p.quarter.to_string())
        .collect();
    let mut c = cfg.clone();
    c.quarter_edits = None;
    c.overrides.quarters = cfg
        .overrides
        .quarters
        .iter()
        .filter(|(k, _)| !child(k) && !resolved.contains(*k))
        .map(|(k, o)| {
            (
                k.clone(),
                QuarterOverride {
                    parts: None,
                    deleted_parts: vec![],
                    ..o.clone()
                },
            )
        })
        .filter(|(_, o)| *o != QuarterOverride::default())
        .collect();
    Cow::Owned(c)
}

fn settings(o: &QuarterOverride) -> QuarterOverride {
    QuarterOverride {
        shape: None,
        parts: None,
        deleted: None,
        deleted_parts: vec![],
        ..o.clone()
    }
}
/// The part's own settings, the source's for the fields it leaves unset.
fn inherited(own: Option<&QuarterOverride>, source: Option<&QuarterOverride>) -> QuarterOverride {
    let own = own.map(settings).unwrap_or_default();
    let Some(src) = source.map(settings) else {
        return own;
    };
    QuarterOverride {
        building_culture: own.building_culture.or(src.building_culture),
        house_config: own.house_config.or(src.house_config),
        role: own.role.or(src.role),
        wealth: own.wealth.or(src.wealth),
        culture: own.culture.or(src.culture),
        tissue: own.tissue.or(src.tissue),
        density: own.density.or(src.density),
        zone: own.zone.or(src.zone),
        shape: None,
        parts: None,
        deleted: None,
        salt: own.salt.or(src.salt),
        deleted_parts: vec![],
    }
}

/// Applies the quarter splits of `cfg` to the finished layout of the quarter
/// stage (built from `base(cfg)`). Without `parts` or part keys: no-op.
pub(super) fn apply(layout: &mut Layout, cfg: &LayoutConfig) {
    let edits = &cfg.overrides.quarters;
    if !edits.iter().any(|(k, o)| child(k) || o.parts.is_some()) {
        return;
    }
    let mut warnings = vec![];
    let n = layout.quarters.len();
    let mut record = QuarterEdits {
        count: n,
        block_count: layout.blocks.len(),
        parts: vec![],
        originals: vec![],
    };
    let mut placed: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    let mut sources: Vec<(usize, &Vec<Shape>)> = edits
        .iter()
        .filter_map(|(k, o)| match (parse_key(k), &o.parts) {
            (Some((i, 0)), Some(parts)) => Some((i, parts)),
            _ => None,
        })
        .collect();
    sources.sort_by_key(|s| s.0);
    for (i, parts) in sources {
        let ignore = |why: &str, warnings: &mut Vec<String>| {
            warnings.push(format!("Quarter edit {i}: parts ignored ({why})"));
        };
        if i >= n {
            ignore("quarter not found", &mut warnings);
            continue;
        }
        if edits[&i.to_string()].deleted == Some(true) {
            ignore("the quarter is deleted", &mut warnings);
            continue;
        }
        let old = layout.quarters[i].clone();
        let pieces = match split(&old.shape, parts) {
            Ok(p) => p,
            Err(why) => {
                ignore(why, &mut warnings);
                continue;
            }
        };
        record.originals.push(OriginalQuarter {
            index: i,
            shape: old.shape.clone(),
        });
        let mut at = Vec::with_capacity(pieces.len());
        for (k, piece) in pieces.iter().enumerate() {
            let q = if k == 0 {
                layout.quarters[i].shape = piece.clone();
                i
            } else {
                layout.quarters.push(Quarter {
                    shape: piece.clone(),
                    phase: old.phase,
                    zone: old.zone.clone(),
                });
                layout.quarters.len() - 1
            };
            at.push(q);
            placed.insert((i, k), q);
            record.parts.push(QuarterPart {
                quarter: q,
                source: i,
                part: k,
                deleted: false,
            });
        }
        split_blocks(layout, i, &pieces, &at, &mut warnings);
        // The parts stay in their source's districts.
        if let Some(st) = layout.structure.as_mut() {
            for d in st.districts.iter_mut().filter(|d| d.quarters.contains(&i)) {
                d.quarters.extend(at[1..].iter().copied());
            }
        }
    }
    // Deleted parts: the outline stays (placeholder, same index), no lot.
    for (k, o) in edits.iter().filter(|(k, _)| child(k)) {
        let Some((i, p)) = parse_key(k) else { continue };
        let Some(&q) = placed.get(&(i, p)) else {
            warnings.push(format!("Quarter edit {k}: ignored (part not found)"));
            continue;
        };
        if o.deleted != Some(true) {
            continue;
        }
        let kept = delete_blocks(layout, q);
        if kept > 0 {
            warnings.push(format!(
                "Quarter edit {k}: {kept} block(s) holding a service or a public space kept"
            ));
        }
        if let Some(r) = record.parts.iter_mut().find(|r| r.quarter == q) {
            r.deleted = true;
        }
    }
    for (key, edit) in edits.iter().filter(|(key, _)| !child(key)) {
        let Some((source, _)) = parse_key(key) else { continue };
        for part in &edit.deleted_parts {
            if let Some(&quarter) = placed.get(&(source, *part)) {
                let kept = delete_blocks(layout, quarter);
                if kept > 0 { warnings.push(format!("Quarter edit {key}/{part}: {kept} public block(s) kept")); }
                if let Some(record) = record.parts.iter_mut().find(|r| r.quarter == quarter) { record.deleted = true; }
            }
        }
    }
    let c = layout.config.get_or_insert_with(Default::default);
    c.overrides = cfg.overrides.clone();
    for (&(i, p), &q) in placed.iter().filter(|((_, p), _)| *p > 0) {
        let own = edits.get(&format!("{i}/{p}"));
        let mut resolved = inherited(own, edits.get(&i.to_string()));
        if own.is_some_and(|o| o.deleted == Some(true)) {
            resolved.deleted = Some(true);
        }
        if resolved != QuarterOverride::default() {
            c.overrides.quarters.insert(q.to_string(), resolved);
        }
    }
    if !record.parts.is_empty() {
        record.parts.sort_by_key(|r| r.quarter);
        c.quarter_edits = Some(record);
    }
    layout.warnings.extend(warnings);
}

fn outline(s: &Shape) -> Option<Shape> {
    largest(g::union(&[g::normalized(Shape {
        outer: s.outer.clone(),
        holes: vec![],
    })]))
}
fn perimeter(s: &Shape) -> f64 {
    std::iter::once(&s.outer)
        .chain(&s.holes)
        .map(|r| {
            (0..r.len())
                .map(|i| {
                    let (a, b) = (r[i], r[(i + 1) % r.len()]);
                    (b.x - a.x).hypot(b.y - a.y)
                })
                .sum::<f64>()
        })
        .sum()
}

/// Parts of a split quarter, in order: each (outer ring only) clipped to the
/// quarter, which keeps its holes, and cut out of the parts before it. All or
/// nothing; the parts must cover the quarter within `COVER_TOLERANCE`, and
/// each uncovered rest joins the part it shares the longest boundary with.
fn split(old: &Shape, parts: &[Shape]) -> Result<Vec<Shape>, &'static str> {
    let old_area = g::area(old);
    let mut taken: Vec<(Shape, BBox)> = vec![];
    let mut out = vec![];
    for part in parts {
        let valid = outline(part).ok_or("degenerate part")?;
        let piece = largest(subtract(g::intersection(&valid, old), &taken))
            .filter(|s| g::area(s) >= MIN_PART)
            .ok_or("a part is empty or too small inside the quarter")?;
        let piece = clean(piece);
        let bb = g::bbox(&piece);
        taken.push((piece.clone(), bb));
        out.push(piece);
    }
    let covered: f64 = out.iter().map(g::area).sum();
    if covered < (1.0 - COVER_TOLERANCE) * old_area {
        return Err("the parts do not cover the quarter");
    }
    for rest in subtract(vec![old.clone()], &taken) {
        if g::area(&rest) <= 0.01 {
            continue;
        }
        let rb = g::bbox(&rest);
        let best = (0..out.len())
            .filter(|&k| bbox_hit(g::bbox(&out[k]), rb, 0.5))
            .filter_map(|k| {
                let mut u = g::union(&[out[k].clone(), rest.clone()]);
                (u.len() == 1).then(|| {
                    let u = u.remove(0);
                    (k, perimeter(&out[k]) + perimeter(&rest) - perimeter(&u), u)
                })
            })
            .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)));
        if let Some((k, _, u)) = best {
            out[k] = clean(u);
        }
    }
    Ok(out)
}

/// Blocks of quarter `source` along its parts (`at[k]`: output quarter of part
/// `k`), then the programme's block references.
fn split_blocks(
    layout: &mut Layout,
    source: usize,
    pieces: &[Shape],
    at: &[usize],
    warnings: &mut Vec<String>,
) {
    let boxes: Vec<BBox> = pieces.iter().map(g::bbox).collect();
    let mut appended: Vec<(usize, Block)> = vec![];
    // Block index → every output block it became (itself first).
    let mut became: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let mut dropped = 0usize;
    for j in 0..layout.blocks.len() {
        if layout.blocks[j].quarter != source {
            continue;
        }
        let b = layout.blocks[j].clone();
        let area = g::area(&b.shape);
        let bb = g::bbox(&b.shape);
        let shares: Vec<(usize, Vec<Shape>)> = (0..pieces.len())
            .filter(|&k| bbox_hit(bb, boxes[k], 0.0))
            .map(|k| (k, g::intersection(&b.shape, &pieces[k])))
            .collect();
        // Inside one part: the exact geometry stays.
        if let Some((k, _)) = shares
            .iter()
            .find(|(_, v)| v.iter().map(g::area).sum::<f64>() >= area - (area * 1e-6).max(0.01))
        {
            layout.blocks[j].quarter = at[*k];
            continue;
        }
        let mut cut: Vec<(usize, Shape)> = vec![];
        for (k, v) in shares {
            for s in v {
                let a = g::area(&s);
                if a >= MIN_PIECE {
                    cut.push((k, clean(s)));
                } else if a > 0.01 {
                    dropped += 1;
                }
            }
        }
        let Some(first) = (0..cut.len()).max_by(|&x, &y| {
            g::area(&cut[x].1)
                .total_cmp(&g::area(&cut[y].1))
                .then(y.cmp(&x))
        }) else {
            // Off every part (cannot happen once the rests are absorbed).
            continue;
        };
        for (m, (k, s)) in cut.into_iter().enumerate() {
            let mut nb = b.clone();
            nb.quarter = at[k];
            if nb.kind == "block" && !served(&s, &layout.streets) {
                nb.kind = "reserve".into();
            }
            nb.shape = s;
            if m == first {
                layout.blocks[j] = nb;
                became.entry(j).or_default().insert(0, j);
            } else {
                appended.push((j, nb));
            }
        }
    }
    for (j, nb) in appended {
        let idx = layout.blocks.len();
        layout.blocks.push(nb);
        became.entry(j).or_default().push(idx);
    }
    if dropped > 0 {
        warnings.push(format!(
            "Quarter edit {source}: {dropped} block sliver(s) under {MIN_PIECE} m² dropped"
        ));
    }
    let Some(p) = layout.programme.as_mut() else { return };
    // Appended pieces take their source block's environment (block-indexed, in order).
    for (&j, outs) in &became {
        if let Some(e) = p.environment.iter().find(|e| e.block == j).cloned() {
            for &idx in &outs[1..] {
                let mut e = e.clone();
                e.block = idx;
                p.environment.push(e);
            }
        }
    }
    // A reservation follows the piece holding most of it, clipped to it.
    for r in &mut p.reservations {
        let Some(outs) = became.get(&r.block) else { continue };
        let best = outs
            .iter()
            .map(|&b| (b, overlap_area(std::slice::from_ref(&layout.blocks[b].shape), &r.shape)))
            .max_by(|x, y| x.1.total_cmp(&y.1).then(y.0.cmp(&x.0)));
        let Some((b, _)) = best.filter(|(_, a)| *a > 0.01) else { continue };
        if b != r.block {
            r.id = match r.id.rsplit_once('/') {
                Some((head, _)) => format!("{head}/{b}"),
                None => r.id.clone(),
            };
            r.block = b;
        }
        r.shape = largest(g::intersection(&r.shape, &layout.blocks[b].shape))
            .map(clean)
            .unwrap_or_else(|| layout.blocks[b].shape.clone());
    }
}

/// The blocks of a deleted part hold no lot (kind `deleted`, same index);
/// those holding a service or a public space stay. Returns how many stayed.
fn delete_blocks(layout: &mut Layout, q: usize) -> usize {
    let reserved: BTreeSet<usize> = layout
        .programme
        .as_ref()
        .map(|p| p.reservations.iter().map(|r| r.block).collect())
        .unwrap_or_default();
    let mut kept = 0;
    for (j, b) in layout.blocks.iter_mut().enumerate() {
        if b.quarter != q {
            continue;
        }
        if reserved.contains(&j) || !matches!(b.kind.as_str(), "block" | "reserve") {
            kept += 1;
            continue;
        }
        b.kind = DELETED.into();
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::super::super::{
        Block, Layout, LayoutConfig, Point, Quarter, QuarterOverride, Shape, Street,
    };
    use super::super::super::geometry as g;
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        Shape {
            outer: vec![
                Point { x: x0, y: y0 },
                Point { x: x1, y: y0 },
                Point { x: x1, y: y1 },
                Point { x: x0, y: y1 },
            ],
            holes: vec![],
        }
    }
    fn block(shape: Shape, quarter: usize) -> Block {
        Block {
            shape,
            quarter,
            kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(),
            phase: Some(0),
        }
    }
    /// Quarter 0: [0,100]², quarter 1: [110,200]×[0,100], a street between.
    /// Quarter 0 holds a left block, a right block and a block across x = 50.
    fn town() -> Layout {
        Layout {
            config: Some(LayoutConfig::default()),
            programme: None,
            key: "t".into(),
            culture: String::new(),
            center: Point { x: 100.0, y: 50.0 },
            quarters: vec![
                Quarter { shape: rect(0.0, 0.0, 100.0, 100.0), phase: 0, zone: "core".into() },
                Quarter { shape: rect(110.0, 0.0, 200.0, 100.0), phase: 0, zone: "core".into() },
            ],
            streets: vec![Street {
                path: vec![Point { x: 105.0, y: -10.0 }, Point { x: 105.0, y: 110.0 }],
                widths: vec![8.0, 8.0],
                rank: 1,
                role: "main".into(),
            }],
            blocks: vec![
                block(rect(5.0, 5.0, 40.0, 40.0), 0),
                block(rect(60.0, 5.0, 95.0, 40.0), 0),
                block(rect(30.0, 60.0, 98.0, 95.0), 0),
                block(rect(115.0, 5.0, 195.0, 95.0), 1),
            ],
            warnings: vec![],
            enclosures: vec![],
            phases: vec![],
            archetype: String::new(),
            structure: None,
            claim: Default::default(),
        }
    }
    fn halves(cfg: &mut LayoutConfig) {
        cfg.overrides.quarters.insert(
            "0".into(),
            QuarterOverride {
                parts: Some(vec![rect(-1.0, -1.0, 50.0, 101.0), rect(50.0, -1.0, 101.0, 101.0)]),
                ..Default::default()
            },
        );
    }
    fn split_town(cfg: &LayoutConfig) -> Layout {
        let mut l = town();
        apply(&mut l, cfg);
        l
    }

    #[test]
    fn split_keeps_other_quarters_and_streets() {
        let mut cfg = LayoutConfig::default();
        halves(&mut cfg);
        let before = town();
        let l = split_town(&cfg);
        assert_eq!(l.quarters.len(), 3);
        assert_eq!(l.quarters[1].shape, before.quarters[1].shape);
        assert_eq!(l.blocks[3].shape, before.blocks[3].shape);
        assert_eq!(l.blocks[3].quarter, 1);
        assert_eq!(serde_json::to_string(&l.streets).unwrap(), serde_json::to_string(&before.streets).unwrap());
    }

    #[test]
    fn split_pieces_cover_the_quarter_and_blocks_follow() {
        let mut cfg = LayoutConfig::default();
        halves(&mut cfg);
        let l = split_town(&cfg);
        let (a0, a1) = (g::area(&l.quarters[0].shape), g::area(&l.quarters[2].shape));
        assert!((a0 - 5000.0).abs() < 1.0 && (a1 - 5000.0).abs() < 1.0, "{a0} {a1}");
        // Whole blocks keep their geometry and index.
        assert_eq!((l.blocks[0].quarter, l.blocks[1].quarter), (0, 2));
        assert_eq!(l.blocks[0].shape, town().blocks[0].shape);
        // The block across the cut: its larger piece (x 50..98) keeps index 2,
        // the other piece is appended after the input blocks.
        assert_eq!(l.blocks.len(), 5);
        assert_eq!((l.blocks[2].quarter, l.blocks[4].quarter), (2, 0));
        assert!((g::area(&l.blocks[2].shape) - 48.0 * 35.0).abs() < 0.5);
        assert!((g::area(&l.blocks[4].shape) - 20.0 * 35.0).abs() < 0.5);
    }

    #[test]
    fn split_record_is_stable_on_repeat_and_parts_inherit() {
        let mut cfg = LayoutConfig::default();
        halves(&mut cfg);
        cfg.overrides.quarters.get_mut("0").unwrap().role = Some("market".into());
        cfg.overrides.quarters.insert("0/1".into(), QuarterOverride { deleted: Some(true), ..Default::default() });
        let (a, b) = (split_town(&cfg), split_town(&cfg));
        assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&b).unwrap());
        let record = a.config.as_ref().unwrap().quarter_edits.clone().unwrap();
        assert_eq!(record.count, 2);
        assert_eq!(record.block_count, 4);
        let keys: Vec<(usize, usize, usize, bool)> =
            record.parts.iter().map(|p| (p.quarter, p.source, p.part, p.deleted)).collect();
        assert_eq!(keys, vec![(0, 0, 0, false), (2, 0, 1, true)]);
        let resolved = &a.config.as_ref().unwrap().overrides.quarters["2"];
        assert_eq!((resolved.role.as_deref(), resolved.deleted), (Some("market"), Some(true)));
        assert_eq!(a.blocks[1].kind, DELETED);
        assert_eq!(a.blocks[0].kind, "block");
        // The plan never sees the split.
        let plan = base(a.config.as_ref().unwrap());
        assert!(plan.overrides.quarters.values().all(|o| o.parts.is_none()));
        assert!(!plan.overrides.quarters.contains_key("0/1") && plan.quarter_edits.is_none());
        assert!(!plan.overrides.quarters.contains_key("2"), "resolved part settings never reach the plan");
    }

    #[test]
    fn split_preserves_holes_and_refuses_partial_cover() {
        let mut l = town();
        l.quarters[0].shape.holes = vec![vec![
            Point { x: 70.0, y: 45.0 },
            Point { x: 70.0, y: 55.0 },
            Point { x: 80.0, y: 55.0 },
            Point { x: 80.0, y: 45.0 },
        ]];
        let mut cfg = LayoutConfig::default();
        halves(&mut cfg);
        apply(&mut l, &cfg);
        assert_eq!(l.quarters.len(), 3);
        assert_eq!(l.quarters[2].shape.holes.len(), 1);
        assert!((g::area(&l.quarters[2].shape) - 4900.0).abs() < 1.0);
        // Parts covering half the quarter: refused, explicitly.
        let mut cfg = LayoutConfig::default();
        cfg.overrides.quarters.insert(
            "0".into(),
            QuarterOverride {
                parts: Some(vec![rect(-1.0, -1.0, 30.0, 101.0), rect(30.0, -1.0, 60.0, 101.0)]),
                ..Default::default()
            },
        );
        let l = split_town(&cfg);
        assert_eq!(l.quarters.len(), 2);
        assert!(l.config.as_ref().unwrap().quarter_edits.is_none());
        assert!(l.warnings.iter().any(|w| w.starts_with("Quarter edit 0: parts ignored")));
    }

    #[test]
    fn malformed_split_edits_are_refused() {
        let mut cfg = LayoutConfig::default();
        cfg.overrides.quarters.insert(
            "0".into(),
            QuarterOverride { parts: Some(vec![rect(0.0, 0.0, 10.0, 10.0)]), ..Default::default() },
        );
        assert!(validate(&cfg).is_err());
        let mut cfg = LayoutConfig::default();
        cfg.overrides.quarters.insert(
            "0/1".into(),
            QuarterOverride { shape: Some(rect(0.0, 0.0, 10.0, 10.0)), ..Default::default() },
        );
        assert!(validate(&cfg).is_err());
    }
}
