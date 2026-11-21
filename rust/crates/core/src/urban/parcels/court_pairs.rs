//! Pairing admitted lots into a shared court with access for both sides.

use super::lot_envelopes;
use super::courts;
use super::admission::witnessed_by;
use super::contacts::Front;
use super::depth::lot_depth;
use super::identity::parcel;
use super::qualification::qualify;
use super::seams::{joined, shared};
use crate::rng::Rng;
use crate::urban::{Layout, Parcel, Point, Shape};
use crate::urban::geometry::area;
use std::collections::BTreeMap;

/// Share of court-house candidates (a run of neighbours on one street that
/// together hold the culture's court house) that become one paired lot: the
/// rest stay the culture's ordinary houses, so a block mixes both types.
pub(super) const COURT_PAIR_SHARE: f64 = 0.55;

/// Court lot pairs (« parcelles appariées pour maisons à cour »): in a tissue
/// whose native house is a court house (atrium, dar, siheyuan) but whose lots
/// are mostly too small for it (only the compact tier admits them), two to
/// four admitted neighbours on the same street are joined into one lot when
/// together they hold the court house's own envelope. Exact: the new lot is
/// the union of its parts (same area, parents recorded), never deeper than
/// the cultural lot depth; it is admitted by the primary (court) profile, so
/// the programme gives it the court dwelling and the preview its court.
#[allow(clippy::too_many_arguments)]
pub(super) fn pair_courts(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    profile: &crate::urban::culture::UrbanAdmissibility,
    fallback: Option<&crate::urban::culture::UrbanAdmissibility>,
    family: &str,
    depth_limit: Option<f64>,
    pack: Option<&str>,
    share: f64,
    rng: &mut Rng,
) {
    if fallback.is_none()
        || share <= 0.0
        || !matches!(
            profile.native_layout.as_str(),
            "courtyard" | "atrium" | "peristyle" | "siheyuan"
        )
    {
        return;
    }
    let inward = family == "courtyard";
    let allowed: Vec<Front> = fronts
        .iter()
        .filter(|f| !f.shared || profile.shared_access)
        .map(|f| Front {
            gate: f.gate || inward,
            ..*f
        })
        .collect();
    // The court house of the pair is a `dwelling` court source of the pack,
    // so the programme's court dwelling keeps its court (`courts::court_kept`).
    let block = cells.first().map_or(0, |c| c.block);
    let court_house = |s: &Shape| {
        pack.is_some_and(|pack| {
            let mut probe = parcel(s.clone(), block, Point { x: 1.0, y: 0.0 }, fronts, "plot");
            probe.family = family.into();
            courts::holds_court(&probe, pack, Some("dwelling"))
        })
    };
    let holds = |s: &Shape| {
        court_house(s)
            && area(s) + 1e-6 >= profile.min_area
            && lot_envelopes::envelope(
                s,
                &allowed,
                profile.min_frontage,
                profile.min_depth,
                profile.min_access_width,
            )
            .is_some()
    };
    let street = |p: &Parcel| p.access.as_ref().and_then(|a| a.street);
    let candidate = |p: &Parcel| {
        p.use_kind == "plot"
            && p.envelope
                .as_ref()
                .is_some_and(|e| !witnessed_by(e, profile))
            && street(p).is_some()
    };
    let mut used = vec![false; cells.len()];
    let mut merged: Vec<(Vec<usize>, Shape)> = Vec::new();
    for i in 0..cells.len() {
        if used[i] || !candidate(&cells[i]) {
            continue;
        }
        let draw = rng.fork(&format!("court-pair:{i}")).float();
        if draw >= share {
            continue;
        }
        let mut group = vec![i];
        let mut shape = cells[i].shape.clone();
        let mut total = area(&shape);
        let mut found = false;
        while group.len() < 4 {
            let next = (0..cells.len())
                .filter(|&j| !used[j] && !group.contains(&j) && candidate(&cells[j]))
                .filter(|&j| street(&cells[j]) == street(&cells[i]))
                .map(|j| (j, shared(&shape, &cells[j].shape)))
                .filter(|&(_, s)| s >= 2.0)
                .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)));
            let Some((j, _)) = next else { break };
            let Some(union) = joined(&shape, &cells[j].shape) else {
                break;
            };
            let sum = total + area(&cells[j].shape);
            // Exact union only (no snapped seam), no hole, within the depth.
            if (area(&union) - sum).abs() > 1e-6 * sum.max(1.0)
                || !union.holes.is_empty()
                || depth_limit.is_some_and(|limit| lot_depth(&union, fronts) > limit + 0.01)
            {
                break;
            }
            group.push(j);
            shape = union;
            total = sum;
            if holds(&shape) {
                found = true;
                break;
            }
        }
        if found {
            for &g in &group {
                used[g] = true;
            }
            merged.push((group, shape));
        }
    }
    if merged.is_empty() {
        return;
    }
    let mut out: Vec<Parcel> = Vec::with_capacity(cells.len());
    let mut lots: Vec<Option<Parcel>> = merged
        .iter()
        .map(|(group, shape)| {
            let first = &cells[group[0]];
            let mut lot = parcel(shape.clone(), first.block, first.axis, fronts, "plot");
            lot.parent_ids = group.iter().map(|&g| cells[g].id.clone()).collect();
            lot.provenance = first.provenance.clone();
            lot.provenance.push("court-pair".into());
            lot.reason = "admissibility-repaired".into();
            let mut one = vec![lot];
            qualify(
                &mut one,
                fronts,
                layout,
                profile,
                fallback,
                inward,
                family,
                depth_limit,
                false,
                0.0,
            );
            one.pop()
        })
        .collect();
    // The court profile must admit the union, else its parts stay as they were.
    let mut leader: BTreeMap<usize, Parcel> = BTreeMap::new();
    let mut gone = vec![false; cells.len()];
    // Invariant (lot balance): a court lot is large for its frontage on its own
    // street, never 3x a neighbour of similar frontage on another one (side or
    // rear lots of a corner): the pair is then not made.
    let front = |p: &Parcel| p.access.as_ref().map_or(0.0, |a| a.front_length);
    let unbalances = |lot: &Parcel, group: &[usize]| {
        let (a, f) = (area(&lot.shape), front(lot));
        cells.iter().enumerate().any(|(k, q)| {
            let g = front(q);
            !group.contains(&k)
                && q.use_kind == "plot"
                && q.envelope.is_some()
                && a >= 3.0 * area(&q.shape)
                && f.min(g) > 0.0
                && f.max(g) <= 1.5 * f.min(g)
                && shared(&lot.shape, &q.shape) >= 1.0
        })
    };
    for ((group, _), lot) in merged.iter().zip(lots.iter_mut()) {
        if let Some(lot) = lot.take().filter(|lot| {
            lot.use_kind == "plot"
                && lot
                    .envelope
                    .as_ref()
                    .is_some_and(|e| witnessed_by(e, profile))
                && !unbalances(lot, group)
        }) {
            for &g in group {
                gone[g] = true;
            }
            leader.insert(group[0], lot);
        }
    }
    for (i, cell) in std::mem::take(cells).into_iter().enumerate() {
        if let Some(lot) = leader.remove(&i) {
            out.push(lot);
        } else if !gone[i] {
            out.push(cell);
        }
    }
    *cells = out;
}
