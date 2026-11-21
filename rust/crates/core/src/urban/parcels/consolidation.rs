//! Merging slivers, joining lots and absorbing leftover land.

use super::tidy;
use super::contacts::{Front, frontage};
use super::cut_geometry::{bounds, length, normal, sub};
use super::depth::{lot_depth, plot_depth};
use super::identity::parcel;
use super::seams::{boxes_touch, joined, shared};
use crate::rng::Rng;
use crate::urban::{Parcel, Shape};
use crate::urban::geometry::area;

pub(super) fn merge_slivers(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    maximum_depth: Option<f64>,
    floor: f64,
) {
    for _ in 0..3 {
        let mut i = 0;
        while i < cells.len() {
            let cell = &cells[i];
            let a = area(&cell.shape);
            let (u0, u1) = bounds(&cell.shape, cell.axis);
            let (v0, v1) = bounds(&cell.shape, normal(cell.axis));
            let gate = frontage(&cell.shape, fronts).1.is_some_and(|f| f.gate);
            let bad = a < if cell.front.is_some() { 35.0 } else { 25.0 }
                || cell
                    .front
                    .is_some_and(|f| length(sub(f[1], f[0])) < if gate { 0.8 } else { 3.6 })
                || (a < 600.0 && (u1 - u0).min(v1 - v0) < 2.2);
            if !bad {
                i += 1;
                continue;
            }
            let mut options: Vec<(usize, f64)> = cells
                .iter()
                .enumerate()
                .filter(|(j, _)| i != *j)
                .map(|(j, other)| {
                    let s = shared(&cell.shape, &other.shape)
                        * (if other.front.is_some() { 1.5 } else { 1.0 });
                    (j, s)
                })
                .filter(|&(_, s)| s > 0.01)
                .collect();
            options.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            // The longest contact first, passing over a neighbour the sliver
            // would only hang from as an arm.
            let mut refused = false;
            let mut chosen = None;
            for &(j, _) in options.iter().take(4) {
                let Some(shape) = joined(&cells[j].shape, &cells[i].shape) else {
                    continue;
                };
                let deep = maximum_depth.is_some_and(|limit| {
                    plot_depth(&shape, cells[j].axis, fronts)
                        .is_some_and(|depth| depth > limit + 0.01)
                });
                if deep || tidy::concave_join(&shape, &cells[i].shape, &cells[j].shape, floor) {
                    refused = true;
                    continue;
                }
                chosen = Some((j, shape));
                break;
            }
            if chosen.is_none() && refused {
                i += 1;
                continue;
            }
            if let Some((j, shape)) = chosen {
                let mut merged = parcel(shape, cells[j].block, cells[j].axis, fronts, "plot");
                merged.parent_ids = vec![cells[j].id.clone(), cells[i].id.clone()];
                merged.provenance = cells[j].provenance.clone();
                merged.provenance.push("sliver-merge".into());
                cells[j] = merged;
                cells.remove(i);
                continue;
            }
            if cells[i]
                .front
                .is_some_and(|f| length(sub(f[1], f[0])) < if gate { 0.8 } else { 3.0 })
            {
                cells[i].front = None;
                cells[i].use_kind = "residual".to_owned();
                cells[i].reason = "insufficient-frontage".into();
            }
            i += 1;
        }
    }
}

/// Post-cut fusion of neighbouring lots: a merchant buys the plot next door.
/// Two admitted lots of one block that share a long side along the same front
/// join into one lot (an L or stepped shape when their depths differ); a
/// smaller share are two shallow lots back to back from opposite streets that
/// join into a through lot. Each lot merges at most once; a union that is not
/// one simple ring, passes the culture's depth or the block's lot size bound,
/// or is refused by `requalify` leaves both lots as they were.
pub(super) fn merge_lots(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    chance: f64,
    depth_limit: Option<f64>,
    requalify: &dyn Fn(&mut Vec<Parcel>),
    rng: &mut Rng,
) {
    let ok = |p: &Parcel| p.use_kind == "plot" && p.envelope.is_some() && p.front.is_some();
    let mut sizes: Vec<f64> = cells.iter().filter(|p| ok(p)).map(|p| area(&p.shape)).collect();
    if sizes.len() < 2 {
        return;
    }
    sizes.sort_by(f64::total_cmp);
    let cap = 2.5 * sizes[sizes.len() / 2];
    let street = |p: &Parcel| p.access.as_ref().and_then(|a| a.street);
    let n = cells.len();
    let mut taken = vec![false; n];
    let mut merged: Vec<(usize, usize, Parcel)> = Vec::new();
    for i in 0..n {
        if taken[i] || !ok(&cells[i]) || !rng.chance(chance) {
            continue;
        }
        let through = rng.chance(0.15);
        let di = lot_depth(&cells[i].shape, fronts);
        let bi = crate::urban::geometry::bbox(&cells[i].shape);
        let mut options: Vec<(usize, f64)> = Vec::new();
        for j in 0..n {
            if j == i || taken[j] || !ok(&cells[j]) {
                continue;
            }
            if !boxes_touch(bi, crate::urban::geometry::bbox(&cells[j].shape)) {
                continue;
            }
            let s = shared(&cells[i].shape, &cells[j].shape);
            let dj = lot_depth(&cells[j].shape, fronts);
            let near = di.min(dj);
            if s < 5.0 || s < 0.35 * near {
                continue;
            }
            let same = street(&cells[i]).is_some() && street(&cells[i]) == street(&cells[j]);
            if through {
                let shallow = depth_limit.map_or(25.0, |l| 0.6 * l);
                if same || di.max(dj) > shallow {
                    continue;
                }
            } else if !same {
                continue;
            }
            // L / stepped shapes need different depths.
            let gap = (di - dj).abs() / di.max(dj).max(1e-6);
            options.push((j, if through { s } else { gap }));
        }
        if options.is_empty() {
            continue;
        }
        options.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        if !through {
            // Mostly the stepped pair; a straight double lot stays possible.
            if options[0].1 < 0.15 && !rng.chance(0.25) {
                continue;
            }
        }
        for &(j, _) in options.iter().take(3) {
            let Some(shape) = joined(&cells[i].shape, &cells[j].shape) else {
                continue;
            };
            if !shape.holes.is_empty() || !crate::urban::geometry::simple(&shape) || area(&shape) > cap {
                continue;
            }
            if depth_limit.is_some_and(|l| lot_depth(&shape, fronts) > l + 0.01) {
                continue;
            }
            let (big, small) = if area(&cells[i].shape) >= area(&cells[j].shape) {
                (i, j)
            } else {
                (j, i)
            };
            let mut lot = parcel(shape, cells[big].block, cells[big].axis, fronts, "plot");
            lot.parent_ids = vec![cells[big].id.clone(), cells[small].id.clone()];
            lot.provenance = cells[big].provenance.clone();
            lot.provenance.push("lot-merge".into());
            let mut probe = vec![lot];
            requalify(&mut probe);
            let lot = probe.remove(0);
            if probe.is_empty()
                && lot.use_kind == "plot"
                && lot.envelope.is_some()
                && lot.front.is_some()
                && lot.access.as_ref().is_some_and(|a| a.kind != "unserved")
            {
                taken[i] = true;
                taken[j] = true;
                merged.push((i, j, lot));
                break;
            }
        }
    }
    if merged.is_empty() {
        return;
    }
    let mut drop = vec![false; n];
    let mut out: Vec<Option<Parcel>> = vec![None; n];
    for (i, j, lot) in merged {
        drop[i.max(j)] = true;
        out[i.min(j)] = Some(lot);
    }
    let old = std::mem::take(cells);
    for (k, p) in old.into_iter().enumerate() {
        if drop[k] {
            continue;
        }
        cells.push(out[k].take().unwrap_or(p));
    }
}

/// Invariant (dense zones keep no empty land): a lot without any admissible
/// house is joined to an adjacent lot of its block (an admitted one or another
/// leftover) as soon as the union holds a witness, whatever its shape (an L, a
/// wedge, a thin row lot made whole): in a town core odd ground is built, not
/// left open. The union must be one ring, stay within the through-lot depth,
/// within `cap` and within `balance` times its smallest neighbour (the
/// 2.5x of the strict repairs is relaxed), and the smallest union is taken so
/// the receivers stay balanced. An admitted lot refuses a union that would hang
/// the leftover from it as an arm (the leftover stays land of its own, no house
/// is lost); two leftovers may still pool, since that can admit a house. Passes
/// repeat: a leftover that gained a neighbour's frontage may serve the next one.
#[allow(clippy::too_many_arguments)]
pub(super) fn absorb(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
    cap: f64,
    balance: f64,
    floor: f64,
) {
    let leftover = |p: &Parcel| {
        (p.use_kind == "plot" && p.envelope.is_none())
            || (p.use_kind == "residual" && p.reason == "insufficient-frontage")
    };
    for _ in 0..4 {
        let mut ids: Vec<(f64, String)> = cells
            .iter()
            .filter(|p| leftover(p))
            .map(|p| (area(&p.shape), p.id.clone()))
            .collect();
        ids.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let mut progressed = false;
        for (_, id) in ids {
            let Some(i) = cells.iter().position(|p| p.id == id) else {
                continue;
            };
            let rb = crate::urban::geometry::bbox(&cells[i].shape);
            let mut near: Vec<(usize, f64)> = cells
                .iter()
                .enumerate()
                .filter(|(j, p)| {
                    *j != i
                        && (p.use_kind == "plot" || leftover(p))
                        && boxes_touch(rb, crate::urban::geometry::bbox(&p.shape))
                })
                .map(|(j, p)| (j, shared(&cells[i].shape, &p.shape)))
                .filter(|&(_, s)| s >= 0.8)
                .collect();
            near.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            let mut best: Option<(usize, Shape, Shape)> = None;
            let mut pooled: Option<(usize, Shape)> = None;
            for &(j, _) in near.iter().take(6) {
                let Some(union) = joined(&cells[i].shape, &cells[j].shape) else {
                    continue;
                };
                if too_deep(&union) || area(&union) > cap {
                    continue;
                }
                if cells[j].envelope.is_some()
                    && tidy::concave_join(&union, &cells[i].shape, &cells[j].shape, floor)
                {
                    continue;
                }
                let ub = crate::urban::geometry::bbox(&union);
                let smallest = cells
                    .iter()
                    .enumerate()
                    .filter(|(k, p)| {
                        *k != i
                            && *k != j
                            && p.use_kind == "plot"
                            && p.envelope.is_some()
                            && boxes_touch(ub, crate::urban::geometry::bbox(&p.shape))
                            && shared(&union, &p.shape) > 1.0
                    })
                    .map(|(_, p)| area(&p.shape))
                    .fold(f64::INFINITY, f64::min);
                if area(&union) > balance * smallest {
                    continue;
                }
                let Some(envelope) = witness(&union) else {
                    // Neighbouring leftovers are pooled: one wider piece may
                    // hold what each thin piece cannot (a row of wedges).
                    if leftover(&cells[j]) && pooled.is_none() {
                        pooled = Some((j, union));
                    }
                    continue;
                };
                if best
                    .as_ref()
                    .is_none_or(|(_, u, _)| area(&union) < area(u))
                {
                    best = Some((j, union, envelope));
                }
            }
            let Some((j, union, envelope)) = best else {
                if let Some((j, union)) = pooled {
                    let mut lot = parcel(union, cells[i].block, cells[i].axis, fronts, "plot");
                    lot.parent_ids = vec![cells[i].id.clone(), cells[j].id.clone()];
                    lot.provenance = cells[i].provenance.clone();
                    lot.provenance.push("residual-pooled".into());
                    let (lo, hi) = (i.min(j), i.max(j));
                    cells[lo] = lot;
                    cells.remove(hi);
                    progressed = true;
                }
                continue;
            };
            let (parents, provenance, axis) = if cells[j].use_kind == "plot" {
                (
                    vec![cells[j].id.clone(), cells[i].id.clone()],
                    cells[j].provenance.clone(),
                    cells[j].axis,
                )
            } else {
                (
                    vec![cells[i].id.clone(), cells[j].id.clone()],
                    cells[i].provenance.clone(),
                    cells[i].axis,
                )
            };
            let mut lot = parcel(union, cells[i].block, axis, fronts, "plot");
            lot.parent_ids = parents;
            lot.provenance = provenance;
            lot.provenance.push("residual-absorbed".into());
            lot.reason = "admissibility-repaired".into();
            lot.envelope = Some(envelope);
            let (lo, hi) = (i.min(j), i.max(j));
            cells[lo] = lot;
            cells.remove(hi);
            progressed = true;
        }
        if !progressed {
            break;
        }
    }
}
