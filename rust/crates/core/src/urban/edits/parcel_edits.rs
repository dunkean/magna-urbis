//! Applying parcel edits and carrying their use and seed overrides.

use super::*;

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
pub(super) const MIN_REMAINDER: f64 = 2.0;

fn lot_served(p: &Parcel) -> bool {
    p.access.as_ref().is_none_or(|a| a.kind != "unserved")
}
/// A lot that hosts a service or a public space (market place, reserved
/// block of the programme): deleting it would leave the service on a garden.
pub(super) fn service_lot(p: &Parcel, layout: &Layout) -> bool {
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

/// Closed parts of a split lot, in order: each clipped to the lot and cut out
/// of the parts before it; together they must cover the lot (a chord cut
/// loses no land). All or nothing.
fn split_lot(old: &Shape, parts: &[Shape]) -> Result<Vec<Shape>, &'static str> {
    let mut taken: Vec<(Shape, (f64, f64, f64, f64))> = vec![];
    let mut out = vec![];
    for part in parts {
        if !valid_shape(part) {
            return Err("invalid part");
        }
        let valid = largest(g::union(&[g::normalized(Shape {
            outer: g::unneedled(&part.outer, LOT_TOLERANCE.1),
            holes: vec![],
        })]))
        .ok_or("degenerate part")?;
        let piece = largest(subtract(g::intersection(&valid, old), &taken))
            .filter(|s| g::area(s) >= MIN_REMAINDER)
            .ok_or("a part is empty or too small")?;
        let piece = clean(piece);
        let bb = g::bbox(&piece);
        taken.push((piece.clone(), bb));
        out.push(piece);
    }
    let area = g::area(old);
    let covered: f64 = out.iter().map(g::area).sum();
    if covered < area - (0.02 * area).max(LOT_TOLERANCE.0) {
        return Err("the parts do not cover the lot");
    }
    Ok(out)
}

/// Hook of the parcel stage, between the lot cut and the programme: lot
/// shapes first, then deletions, each in id order. Every edit is all or
/// nothing: it is tried on a copy and kept only when the block stays an exact
/// partition in which every served lot stays served.
pub(in super::super) fn apply_parcel_edits(layout: &Layout, partition: &mut Partition) {
    let Some(cfg) = partition.config.as_ref() else {
        return;
    };
    let edits: Vec<(String, ParcelOverride)> = cfg
        .overrides
        .parcels
        .iter()
        .filter(|(_, o)| o.shape.is_some() || o.parts.is_some() || o.deleted.is_some())
        .map(|(k, o)| (k.clone(), o.clone()))
        .collect();
    if edits.is_empty() {
        return;
    }
    // Splits first (a part is then addressable by its own id), then shapes,
    // then deletions, each in id order.
    let edits: Vec<(String, ParcelOverride)> = edits
        .iter()
        .filter(|(_, o)| o.parts.is_some())
        .chain(edits.iter().filter(|(_, o)| o.parts.is_none()))
        .cloned()
        .collect();
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
    for (id, o) in edits.iter().filter(|(_, o)| o.parts.is_some()) {
        let Some(ai) = find(&lots, id) else {
            warnings.push(warnings::lot_split_ignored(id, "lot not found"));
            continue;
        };
        let source = lots[ai].as_ref().unwrap();
        let bi = source.block;
        match split_lot(&source.shape, o.parts.as_ref().unwrap()) {
            Err(why) => warnings.push(warnings::lot_split_ignored(id, why)),
            Ok(pieces) => {
                before.entry(bi).or_insert_with(|| metrics(&lots, bi));
                let source = lots[ai].as_ref().unwrap().clone();
                let (slot, rank) = order[ai];
                let mut pieces = pieces.into_iter();
                let first = lots[ai].as_mut().unwrap();
                first.shape = pieces.next().unwrap();
                requalify(first, layout, &index, "edit:split");
                for (k, piece) in pieces.enumerate() {
                    let mut part = source.clone();
                    part.id = format!("{id}/part-{}", k + 1);
                    part.parent_ids = vec![id.clone()];
                    part.provenance = vec!["edit:split".into()];
                    part.shape = piece;
                    requalify(&mut part, layout, &index, "edit:split");
                    if !lot_served(&part) {
                        warnings.push(warnings::lot_part_unserved(id, k + 1));
                    }
                    lots.push(Some(part));
                    order.push((slot, rank + k + 1));
                }
            }
        }
    }
    for (id, o) in edits.iter().filter(|(_, o)| o.shape.is_some()) {
        let user = o.shape.as_ref().unwrap();
        let Some(ai) = find(&lots, id) else {
            warnings.push(warnings::lot_edit_missing(id));
            continue;
        };
        let bi = lots[ai].as_ref().unwrap().block;
        let Some(block) = layout.blocks.get(bi) else {
            continue;
        };
        let ignore = |why: &str, warnings: &mut Vec<String>| {
            warnings.push(warnings::lot_shape_ignored(id, why));
        };
        if !valid_shape(user) {
            ignore("invalid outline", &mut warnings);
            continue;
        }
        // Needles narrower than the tolerance (the lot's own zero-width ones,
        // rounded by the inspector) would cross and flip the fill.
        let Some(valid) = largest(g::union(&[g::normalized(Shape {
            outer: g::unneedled(&user.outer, LOT_TOLERANCE.1),
            holes: vec![],
        })])) else {
            ignore("degenerate outline", &mut warnings);
            continue;
        };
        let old = lots[ai].as_ref().unwrap().shape.clone();
        if overlap_area(std::slice::from_ref(&valid), &old) < 0.1 * g::area(&old) {
            ignore("no longer covers the lot", &mut warnings);
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
            ignore("same as the current outline", &mut warnings);
            continue;
        };
        let Some(shape) = shape.filter(|s| g::area(s) >= 4.0) else {
            ignore("outside block or too small", &mut warnings);
            continue;
        };
        if moved_area(&shape, &old) < 0.5 {
            ignore("no change within block", &mut warnings);
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
                ignore("would lose street access", &mut warnings);
            } else {
                warnings.push(warnings::lot_neighbour_unserved(id, &who));
            }
            continue;
        }
        for gone in absorbed {
            warnings.push(warnings::lot_absorbed(id, &gone));
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
            warnings.push(warnings::lot_edit_missing(id));
            continue;
        };
        let bi = lots[ai].as_ref().unwrap().block;
        if service_lot(lots[ai].as_ref().unwrap(), layout) {
            warnings.push(warnings::public_lot_kept(id));
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
            warnings.push(warnings::lot_left_garden(id));
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
pub(in super::super) fn sets_use(ov: &ParcelOverride) -> bool {
    ov.deleted.is_none()
        && (ov.role.is_some()
            || ov.function.is_some()
            || ov.households.is_some()
            || ov.salt.is_some_and(|s| s > 0))
}
/// A salt without a role draws one admissible use, by a hash of the lot id
/// and the salt, among the distinct (role, function) of the town's ordinary
/// demands; a role or function wins and the salt then only reseeds the house.
pub(in super::super) fn forced_use<'a>(
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
        return Err(warnings::lot_no_admissible_use(id));
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
pub(in super::super) fn building_seed(seed: &str, id: &str, partition: &Partition) -> String {
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
