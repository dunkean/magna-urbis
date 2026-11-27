//! Native admission rules, access seating and qualification of cut lots.

use super::lot_envelopes;
use super::{contacts, tidy};
use super::admission::witnessed_by;
use super::consolidation::absorb;
use super::contacts::{Front, access_kind};
use super::cut_geometry::{dot, length, sub, unit};
use super::depth::lot_depth;
use super::fields::field_grid;
use super::identity::parcel;
use super::lot_envelopes::{DEGENERATE, DEGENERATE_SCALES, POLYGONAL, POLYGONAL_REACH};
use super::neighbour_repair::{Repair, balance_neighbours, rebalance, share_out, split_corners};
use super::seams::{boxes_touch, joined, shared};
use crate::urban::{Layout, Parcel, Shape};
use crate::urban::geometry::area;

/// The tier that admits a lot (the lenient one for refusals) and whether it is
/// entered by a gate rather than a frontage.
pub(super) fn rule_of<'a>(
    p: &Parcel,
    spans: &[(f64, f64)],
    profile: &'a crate::urban::culture::UrbanAdmissibility,
    fallback: Option<&'a crate::urban::culture::UrbanAdmissibility>,
    inward: bool,
) -> (&'a crate::urban::culture::UrbanAdmissibility, bool) {
    let primary = p
        .envelope
        .as_ref()
        .is_some_and(|e| witnessed_by(e, profile));
    let rule = if primary || fallback.is_none() {
        profile
    } else {
        fallback.unwrap_or(profile)
    };
    let polygonal = p
        .provenance
        .iter()
        .any(|x| x == POLYGONAL || x == DEGENERATE);
    // A lot of odd ground whose street contact is shorter than the
    // frontage rule is entered by a passage (the access width rule).
    let narrow = polygonal && !spans.iter().any(|(lo, hi)| hi - lo + 1e-6 >= rule.min_frontage);
    (rule, (inward && primary) || narrow)
}

/// A lot's front, rank, street, access kind, front length, corner mark and
/// contacts, all read together from its outline's `contacts`.
pub(super) fn seat(
    p: &mut Parcel,
    contacts: &[Front],
    spans: &[(f64, f64)],
    rule: &crate::urban::culture::UrbanAdmissibility,
    gated: bool,
    layout: &Layout,
) {
    let minimum = if p.use_kind == "court" {
        1.2
    } else {
        rule.min_frontage
    };
    let best = contacts
        .iter()
        .zip(spans)
        .map(|(f, (lo, hi))| (f, hi - lo))
        .filter(|(f, span)| {
            *span + 1e-6
                >= if f.gate || gated {
                    rule.min_access_width
                } else {
                    minimum
                }
                && (!f.shared || rule.shared_access || p.use_kind == "court")
        })
        .min_by(|(a, sa), (b, sb)| {
            a.rank
                .cmp(&b.rank)
                .then(a.shared.cmp(&b.shared))
                .then_with(|| sb.total_cmp(sa))
        });
    let support = best.map_or(0.0, |(_, span)| span);
    let best = best.map(|(f, _)| f);
    p.front = best.map(|f| [f.a, f.b]);
    p.rank = best.map_or(99, |f| f.rank);
    p.access = Some(crate::urban::ParcelAccess {
        // A court house is entered through its own gate, not a shop front.
        kind: best
            .map_or("unserved", |f| match access_kind(f, layout) {
                "public" if gated => "private",
                kind => kind,
            })
            .into(),
        street: best.map(|f| f.street),
        front_length: support,
    });
    if p.use_kind == "plot"
        && !p.provenance.iter().any(|x| x == "corner-lot")
        && contacts.iter().enumerate().any(|(i, f)| {
            contacts.iter().skip(i + 1).any(|g| {
                length(sub(f.b, f.a)) >= 3.0
                    && length(sub(g.b, g.a)) >= 3.0
                    && dot(unit(sub(f.b, f.a)), unit(sub(g.b, g.a))).abs()
                        < 45.0_f64.to_radians().cos()
            })
        })
    {
        p.provenance.push("corner-lot".into());
    }
    p.contacts = contacts
        .iter()
        .map(|f| crate::urban::ParcelContact {
            a: f.a,
            b: f.b,
            street: f.street,
            rank: f.rank,
            length: length(sub(f.b, f.a)),
            kind: access_kind(f, layout).into(),
        })
        .collect();
}

/// `shape` still answers its lot's tier: its surface, and an entry the tier
/// admits on one continuous support (the witness is checked by the caller).
pub(super) fn answers_tier(
    p: &Parcel,
    shape: &Shape,
    fronts: &[Front],
    profile: &crate::urban::culture::UrbanAdmissibility,
    fallback: Option<&crate::urban::culture::UrbanAdmissibility>,
    inward: bool,
) -> bool {
    let contacts = contacts::boundary_contacts(shape, fronts);
    let spans = contacts::support_spans(&contacts);
    let (rule, gated) = rule_of(p, &spans, profile, fallback, inward);
    area(shape) + 1e-6 >= rule.min_area
        && contacts.iter().zip(&spans).any(|(f, (lo, hi))| {
            hi - lo + 1e-6
                >= if f.gate || gated {
                    rule.min_access_width
                } else {
                    rule.min_frontage
                }
                && (!f.shared || rule.shared_access)
        })
}

/// Two bounded local repair passes. Every accepted repair must contain the
/// cultural witness; courts, reserves and intentional gardens are immutable.
/// A lot is admitted by the primary native recipe or, failing that, by the
/// pack's compact `fallback`. With `inward` (courtyard families) the primary
/// house sits anywhere in its lot behind a gate: any contact as wide as the
/// recipe's access admits it, never a 30 m street frontage.
#[allow(clippy::too_many_arguments)]
pub(super) fn qualify(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    profile: &crate::urban::culture::UrbanAdmissibility,
    fallback: Option<&crate::urban::culture::UrbanAdmissibility>,
    inward: bool,
    family: &str,
    depth_limit: Option<f64>,
    dense: bool,
    floor: f64,
) {
    // The fronts a profile admits do not depend on the lot: built once.
    let admitted = |a: &crate::urban::culture::UrbanAdmissibility, gated: bool| -> Vec<Front> {
        fronts
            .iter()
            .filter(|f| !f.shared || a.shared_access)
            .map(|f| Front {
                gate: f.gate || gated,
                ..*f
            })
            .collect()
    };
    let primary = admitted(profile, inward);
    let secondary = fallback.map(|f| admitted(f, false));
    let tier = |shape: &Shape, a: &crate::urban::culture::UrbanAdmissibility, allowed: &[Front]| {
        if area(shape) + 1e-6 < a.min_area {
            return None;
        }
        lot_envelopes::envelope(
            shape,
            allowed,
            a.min_frontage,
            a.min_depth,
            a.min_access_width,
        )
    };
    let witness = |shape: &Shape| {
        tier(shape, profile, &primary)
            .or_else(|| fallback.zip(secondary.as_deref()).and_then(|(f, allowed)| tier(shape, f, allowed)))
    };
    for p in cells.iter_mut().filter(|p| p.use_kind == "plot") {
        p.envelope = witness(&p.shape);
    }
    // Lot size bound for merges: 2x the block's median admitted lot.
    let cap = {
        let mut admitted: Vec<f64> = cells
            .iter()
            .filter(|p| p.use_kind == "plot" && p.envelope.is_some())
            .map(|p| area(&p.shape))
            .collect();
        admitted.sort_by(f64::total_cmp);
        admitted
            .get(admitted.len() / 2)
            .map_or(f64::INFINITY, |m| 2.0 * m.max(2.0 * profile.min_area))
    };
    for _ in 0..2 {
        let mut i = 0;
        while i < cells.len() {
            if cells[i].use_kind != "plot" || cells[i].envelope.is_some() {
                i += 1;
                continue;
            }
            let mut candidates: Vec<_> = cells
                .iter()
                .enumerate()
                .filter(|(j, p)| *j != i && p.use_kind == "plot")
                .map(|(j, p)| (j, shared(&cells[i].shape, &p.shape)))
                .filter(|&(_, s)| s > 0.05)
                .collect();
            candidates.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            let deep =
                |s: &Shape| depth_limit.is_some_and(|limit| lot_depth(s, fronts) > limit + 0.01);
            let repair = candidates.into_iter().take(8).find_map(|(j, _)| {
                let shape = joined(&cells[i].shape, &cells[j].shape)?;
                // A balanced re-split of the pair along their common side comes
                // first: two equal lots instead of one double lot beside a small one.
                if let Some(split) = rebalance(&shape, &cells[i].shape, &cells[j].shape) {
                    let envelopes = (witness(&split[0]), witness(&split[1]));
                    if let (Some(a), Some(b)) = envelopes
                        && !deep(&split[0])
                        && !deep(&split[1])
                    {
                        let [x, y] = split;
                        return Some((j, Repair::Split([(x, a), (y, b)])));
                    }
                }
                // No family may merge past the cultural lot depth (bug 2b), nor
                // past the block's lot size bound (no 10x lot beside its neighbours),
                // nor past 2.5x its smallest admitted neighbour: such a cell is
                // shared out among its neighbours below instead.
                if deep(&shape) || area(&shape) > cap {
                    return None;
                }
                // Next neighbour rather than a concave union with an admitted
                // lot: the merge would only move an arm onto it. Two refused
                // lots may still join, the union can admit a house.
                if cells[j].envelope.is_some()
                    && tidy::concave_join(&shape, &cells[i].shape, &cells[j].shape, floor)
                {
                    return None;
                }
                let merged = area(&shape);
                let sb = crate::urban::geometry::bbox(&shape);
                let smallest = cells
                    .iter()
                    .enumerate()
                    .filter(|(k, p)| {
                        *k != i
                            && *k != j
                            && p.use_kind == "plot"
                            && p.envelope.is_some()
                            && boxes_touch(sb, crate::urban::geometry::bbox(&p.shape))
                            && shared(&shape, &p.shape) > 0.5
                    })
                    .map(|(_, p)| area(&p.shape))
                    .fold(f64::INFINITY, f64::min);
                if merged > 2.5 * smallest {
                    return None;
                }
                let envelope = witness(&shape)?;
                Some((j, Repair::Merge(shape, envelope)))
            });
            match repair {
                Some((j, Repair::Merge(shape, envelope))) => {
                    let mut repaired = parcel(shape, cells[i].block, cells[i].axis, fronts, "plot");
                    repaired.parent_ids = vec![cells[i].id.clone(), cells[j].id.clone()];
                    repaired.provenance = vec!["admissibility-merge".into()];
                    repaired.reason = "admissibility-repaired".into();
                    repaired.envelope = Some(envelope);
                    cells[i] = repaired;
                    cells.remove(j);
                    if j < i {
                        i = i.saturating_sub(1);
                    }
                }
                Some((j, Repair::Split(halves))) => {
                    let parents = vec![cells[i].id.clone(), cells[j].id.clone()];
                    for (k, (shape, envelope)) in [i, j].into_iter().zip(halves) {
                        let mut lot = parcel(shape, cells[k].block, cells[k].axis, fronts, "plot");
                        lot.parent_ids = parents.clone();
                        lot.provenance = vec!["admissibility-rebalance".into()];
                        lot.reason = "admissibility-repaired".into();
                        lot.envelope = Some(envelope);
                        cells[k] = lot;
                    }
                    i += 1;
                }
                None => i += 1,
            }
        }
    }
    // Through lots may reach a little past the cultural depth: their second
    // contact is a street, not back land.
    let through_deep =
        |s: &Shape| depth_limit.is_some_and(|limit| lot_depth(s, fronts) > 1.25 * limit + 0.01);
    let unshared = |s: &Shape| through_deep(s) || tidy::solidity(s) < floor;
    let mut i = 0;
    while i < cells.len() {
        let leftover = (cells[i].use_kind == "plot" && cells[i].envelope.is_none())
            || (cells[i].use_kind == "residual" && cells[i].reason == "insufficient-frontage");
        if leftover && share_out(cells, i, fronts, &witness, &unshared, cap) {
            continue;
        }
        i += 1;
    }
    let strict_deep =
        |s: &Shape| depth_limit.is_some_and(|limit| lot_depth(s, fronts) > limit + 0.01);
    if dense {
        absorb(cells, fronts, &witness, &through_deep, 1.5 * cap, 3.5, floor);
        // Odd ground that holds the admission rectangle only slanted is still
        // a house lot: the leftover is admitted by a free witness, never
        // before a join was tried.
        for p in cells.iter_mut().filter(|p| p.use_kind == "plot" && p.envelope.is_none()) {
            let free = |a: &crate::urban::culture::UrbanAdmissibility| {
                if area(&p.shape) + 1e-6 < a.min_area {
                    return None;
                }
                let allowed: Vec<_> = fronts
                    .iter()
                    .filter(|f| !f.shared || a.shared_access)
                    .copied()
                    .collect();
                lot_envelopes::free_envelope(
                    &p.shape,
                    &allowed,
                    a.min_frontage,
                    a.min_depth,
                    a.min_access_width,
                    POLYGONAL_REACH,
                )
            };
            if let Some(e) = free(profile).or_else(|| fallback.and_then(free)) {
                p.envelope = Some(e);
                p.provenance.push(POLYGONAL.into());
            }
        }
        // Odd ground too thin for the full rectangle keeps the largest
        // scaled-down body it holds (at least half the minimal house area).
        for p in cells.iter_mut().filter(|p| p.use_kind == "plot" && p.envelope.is_none()) {
            let small = fallback.unwrap_or(profile);
            if area(&p.shape) < 0.5 * small.min_area {
                continue;
            }
            let allowed: Vec<_> = fronts
                .iter()
                .filter(|f| !f.shared || small.shared_access)
                .copied()
                .collect();
            let found = DEGENERATE_SCALES[1..].iter().copied()
                .find_map(|k| lot_envelopes::free_envelope(
                    &p.shape,
                    &allowed,
                    small.min_frontage * k,
                    small.min_depth * k,
                    small.min_access_width,
                    POLYGONAL_REACH,
                ));
            if let Some(e) = found {
                p.envelope = Some(e);
                p.provenance.push(DEGENERATE.into());
            }
        }
        // Land that holds no native house at all (a few square metres of
        // wedge) is not left as an unowned hole: it is the court or garden of
        // the lot beside it (attached below), or a pocket garden of its own.
        for p in cells.iter_mut().filter(|p| {
            (p.use_kind == "plot" && p.envelope.is_none())
                || (p.use_kind == "residual" && p.reason == "insufficient-frontage")
        }) {
            p.use_kind = "garden".into();
            p.reason = "retained-backland".into();
            p.envelope = None;
            p.provenance.push("dense-leftover".into());
        }
    }
    balance_neighbours(cells, fronts, &witness, &strict_deep, floor);
    split_corners(cells, fronts, &witness, &strict_deep);
    // Frontage rule of the tier that admitted the lot (the lenient one for refusals).
    let lenient = fallback.unwrap_or(profile);
    for p in cells.iter_mut() {
        p.family = family.into();
        let contacts = contacts::boundary_contacts(&p.shape, fronts);
        let spans = contacts::support_spans(&contacts);
        let (rule, gated) = rule_of(p, &spans, profile, fallback, inward);
        if p.use_kind == "plot" {
            if p.envelope.is_none() {
                p.use_kind = "residual".into();
                p.reason = if !contacts.iter().zip(&spans).any(|(f, (lo, hi))| {
                    hi - lo + 1e-6
                        >= if f.gate {
                            lenient.min_access_width
                        } else {
                            lenient.min_frontage
                        }
                }) {
                    "insufficient-cultural-frontage"
                } else {
                    "no-admissible-envelope"
                }
                .into();
            } else if p.reason != "admissibility-repaired" {
                p.reason = "admissible-envelope".into();
            }
        } else if p.reason == "insufficient-frontage" {
            p.use_kind = "residual".into();
        }
        seat(p, &contacts, &spans, rule, gated, layout);
    }
    // Back land larger than a few crofts (a deep block no lane could reach:
    // slope, water) is not one lot's garden of hectares: it is fenced into
    // field plots along the block's axis, open land of the town's edge.
    let mut fields = vec![];
    cells.retain(|c| {
        if c.use_kind != "garden" || c.reason != "retained-backland" || area(&c.shape) <= 6000.0 {
            return true;
        }
        let pieces = field_grid(&c.shape, c.axis, 45.0, 75.0);
        if pieces.len() < 2 {
            return true;
        }
        for piece in pieces {
            let mut q = parcel(piece, c.block, c.axis, &[], "garden");
            q.reason = "backland-field".into();
            q.family = "reserve".into();
            q.provenance = vec!["retained-backland".into(), "backland-field".into()];
            fields.push(q);
        }
        false
    });
    cells.extend(fields);
    // A retained rear property is attached through ownership, without inventing
    // a street facade. Its geometry and its owner's ID both stay inspectable.
    for i in 0..cells.len() {
        if cells[i].use_kind != "garden" || cells[i].reason != "retained-backland" {
            continue;
        }
        let neighbor = cells
            .iter()
            .enumerate()
            .filter(|(_, p)| p.use_kind == "plot")
            .map(|(j, p)| (j, shared(&cells[i].shape, &p.shape)))
            .filter(|&(_, s)| s > 0.05)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((j, _)) = neighbor {
            cells[i].parent_ids = vec![cells[j].id.clone()];
            cells[i].reason = "attached-rear-land".into();
            cells[i].provenance.push("rear-land-attachment".into());
            cells[i].access = Some(crate::urban::ParcelAccess {
                kind: "attached".into(),
                street: cells[j].access.as_ref().and_then(|a| a.street),
                front_length: 0.0,
            });
        }
    }
}
