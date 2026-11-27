//! Quarter edit pipeline and provenance through layout finishing.

use super::*;

/// Config without any structural field (empty entries dropped): `L0`.
pub(super) fn stripped(cfg: &LayoutConfig) -> LayoutConfig {
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
/// Quarter splits (`parts`) are never seen by the plan: they are applied once,
/// last, on the finished layout (`quarter_parts`).
pub(in super::super) fn with_quarter_edits(
    cfg: &LayoutConfig,
    plan: impl Fn(&LayoutConfig) -> Result<Layout, String> + Sync + Send,
    finish: impl Fn(&mut Layout) -> Result<(), String> + Sync + Send,
) -> Result<(Layout, Option<Layout>), String> {
    validate_quarters(cfg)?;
    let base = quarter_parts::base(cfg);
    let (mut layout, baseline) = spliced_quarters(&base, plan, finish)?;
    quarter_parts::apply(&mut layout, cfg);
    Ok((layout, baseline))
}
fn spliced_quarters(
    cfg: &LayoutConfig,
    plan: impl Fn(&LayoutConfig) -> Result<Layout, String> + Sync + Send,
    finish: impl Fn(&mut Layout) -> Result<(), String> + Sync + Send,
) -> Result<(Layout, Option<Layout>), String> {
    if !cfg.overrides.quarters.values().any(structural) {
        let mut layout = plan(cfg)?;
        finish(&mut layout)?;
        return Ok((layout, None));
    }
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    let mut warnings = vec![];
    // The variant plan does not read the stripped one: with spare threads both
    // run at once, and an unneeded variant is dropped.
    let speculate = super::super::par::threads() > 1
        && cfg.overrides.quarters.values().any(|o| {
            structural(o) && o.deleted != Some(true) && (salt_of(o).is_some() || o.shape.is_some())
        });
    let (l0, mut speculated) = if speculate {
        let mut both = super::super::par::range(2, |i| plan(&if i == 0 { stripped(cfg) } else { variant(cfg) }));
        let l1 = both.pop();
        (both.pop().expect("stripped plan"), l1)
    } else {
        (plan(&stripped(cfg)), None)
    };
    let mut l0 = l0?;
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
            _ => warnings.push(warnings::quarter_edit_missing(k)),
        }
    }
    let l1 = if edits.values().any(|e| !e.deleted && (e.salt || e.shape)) {
        Some(match speculated.take() {
            Some(l1) => l1?,
            None => plan(&variant(cfg))?,
        })
    } else {
        None
    };
    // Carry the variant plan's verdicts on quarter outlines into the splice.
    if let Some(l1) = &l1 {
        warnings.extend(
            l1.warnings
                .iter()
                .filter(|w| warnings::quarter_outline_key(w).is_some())
                .cloned(),
        );
    }
    let Splice {
        layout: mut spliced,
        origin,
        edited,
    } = splice(&l0, l1.as_ref(), &edits, &mut warnings);
    spliced.programme = None;
    let freeze_inputs = FreezeInputs::new(&spliced, &l0, &origin);
    // Both finishes are independent; errors keep the serial order.
    let (spliced_done, l0_done) = if super::super::par::threads() > 1 {
        let slots = [std::sync::Mutex::new(Some(spliced)), std::sync::Mutex::new(Some(l0))];
        let mut done = super::super::par::range(2, |i| {
            let mut l = slots[i].lock().expect("finish slot").take().expect("finish layout");
            let r = finish(&mut l);
            (l, r)
        });
        let second = done.pop().expect("finished stripped layout");
        (done.pop().expect("finished spliced layout"), second)
    } else {
        finish(&mut spliced)?;
        finish(&mut l0)?;
        ((spliced, Ok(())), (l0, Ok(())))
    };
    let (mut spliced, r) = spliced_done;
    r?;
    let (l0, r0) = l0_done;
    r0?;
    let (origin, streets, kinds) = freeze_inputs.remap(&spliced, &l0);
    freeze(&mut spliced, &l0, &origin, &streets, &kinds, &mut warnings);
    spliced.warnings.extend(warnings);
    // The parcel stage reads the salts and deletions.
    if let Some(c) = spliced.config.as_mut() {
        c.overrides = cfg.overrides.clone();
    }
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  edits.quarters: {:.0} ms ({} edited)",
            tick.elapsed().as_secs_f64() * 1000.0,
            edited.len()
        );
    }
    let baseline = (!edited.is_empty() && origin.iter().any(Option::is_some)).then_some(l0);
    Ok((spliced, baseline))
}

/// Finishing can split/reorder blocks (deep lanes, source-site ground) and prune or subdivide streets. Splice indices
/// refer to the unfinished layouts, so carry their provenance through exact geometry identities before freezing the
/// final programme. A new or recut block keeps the finished programme's own choice; an unchanged block keeps L0's.
pub(super) struct FreezeInputs {
    blocks: BTreeMap<Vec<u8>, (Option<Vec<u8>>, String)>,
}
fn block_identity(b: &Block) -> Vec<u8> {
    // The programme may change the kind to reserve:* without changing the physical block's identity.
    serde_json::to_vec(&(b.quarter, b.phase, &b.zone, b.axis, &b.shape)).expect("block identity")
}
impl FreezeInputs {
    pub(super) fn new(spliced: &Layout, l0: &Layout, origin: &[Option<usize>]) -> Self {
        let blocks = spliced.blocks.iter().zip(origin).map(|(b, source)| {
            (block_identity(b), (source.map(|i| block_identity(&l0.blocks[i])), b.kind.clone()))
        }).collect();
        Self { blocks }
    }
    pub(super) fn remap(&self, spliced: &Layout, l0: &Layout) -> (Vec<Option<usize>>, Vec<Option<usize>>, Vec<String>) {
        let base: BTreeMap<Vec<u8>, usize> = l0.blocks.iter().enumerate().rev()
            .map(|(i, b)| (block_identity(b), i)).collect();
        let mut origin = Vec::with_capacity(spliced.blocks.len());
        let mut kinds = Vec::with_capacity(spliced.blocks.len());
        for b in &spliced.blocks {
            let before = self.blocks.get(&block_identity(b));
            origin.push(before.and_then(|(source, _)| source.as_ref()).and_then(|key| base.get(key)).copied());
            kinds.push(before.map_or_else(|| b.kind.clone(), |(_, kind)| kind.clone()));
        }
        // Reservation street indices also belong to the finished layouts. Width/rank changes keep the same axis;
        // paths removed or cut differently cannot inherit a reservation through an old numeric position.
        let streets: BTreeMap<Vec<u8>, usize> = spliced.streets.iter().enumerate().rev()
            .map(|(i, s)| (serde_json::to_vec(&s.path).expect("street identity"), i)).collect();
        let street_map = l0.streets.iter().map(|s| streets.get(&serde_json::to_vec(&s.path).expect("street identity")).copied()).collect();
        (origin, street_map, kinds)
    }
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
            warnings.push(warnings::quarter_redraw_missing(i));
            continue;
        };
        let (a0, a1) = (g::area(&q0.shape), g::area(&q1.shape));
        let reshaped = e.shape && q1.shape != q0.shape;
        if !reshaped && (a1 - a0).abs() > 0.01 * a0.max(1.0) {
            warnings.push(warnings::quarter_redraw_unstable(i));
            continue;
        }
        // Never silent: a shape the variant plan did not apply says so.
        if e.shape && !reshaped && !warnings.iter().any(|w| warnings::quarter_outline_key(w) == Some(i)) {
            warnings.push(warnings::quarter_shape_ignored(i, "no change to layout"));
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
            warnings.push(warnings::quarter_clipped_neighbours(i, n));
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
    for (k, st) in l0.streets.iter().enumerate() {
        if removed.contains(&k) {
            continue;
        }
        streets.push(st.clone());
    }
    let dropped = removed.len();
    let base_count = streets.len();
    let works = with_boxes(s.enclosures.iter().flat_map(circuit_ground).collect());
    if let Some(l1) = l1 {
        for (&i, _) in &redrawn {
            let q1 = &l1.quarters[i].shape;
            let foreign: Vec<&Shape> = kept
                .iter()
                .copied()
                .filter(|b| bbox_hit(g::bbox(b), g::bbox(q1), 20.0))
                .chain(works.iter().filter(|(_, b)| bbox_hit(*b, g::bbox(q1), 20.0)).map(|(shape, _)| shape))
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
                    warnings.push(warnings::quarter_street_intrusion(i));
                    continue;
                }
                streets.push(st.clone());
            }
            if skipped > 0 {
                warnings.push(warnings::quarter_streets_skipped(i, skipped));
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
                    .chain(works.iter().filter(|(_, b)| bbox_hit(*b, qb, 0.0)).map(|(shape, _)| shape.clone()))
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
                warnings.push(warnings::quarter_no_blocks(i));
            }
            let before = blocks_signature(l0, i);
            let after: Vec<String> = out
                .iter()
                .map(|b| serde_json::to_string(&b.shape).unwrap_or_default())
                .collect();
            if before == after {
                warnings.push(warnings::quarter_blocks_unchanged(i));
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
        warnings.push(warnings::quarters_deleted(deleted.len(), dropped));
    }
    Splice {
        layout: s,
        origin,
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
        let retag = |r: &super::super::programme::Reservation, b: usize| match r.id.rsplit_once('/') {
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
                    let contacts = super::super::parcels::block_contacts(&nb.shape, s);
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
                        super::super::parcels::continuous_frontage(&contacts),
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
            warnings.push(warnings::services_displaced(displaced));
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
