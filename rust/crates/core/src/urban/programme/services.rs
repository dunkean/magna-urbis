//! Explicit and retained uses, reserved institutions, sited trades and legacy fill.

use crate::urban::{Parcel, ParcelOverride, roles, warnings};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use super::{UrbanProgramme, admission::{Memo, ReservedFor, eligible_memo},
    allocation::{RetainedLots, Sites, take}, demand::{capacity, default_role, demand}, dist};

pub(super) type ForcedUse = (String, Option<f64>);

/// Assignments kept ahead of shops and housing, and the demand order for reconciliation.
pub(super) struct EarlyAssignments {
    pub(super) forced: Vec<Option<ForcedUse>>,
    pub(super) locked: Vec<bool>,
    pub(super) order: Vec<usize>,
    pub(super) dwelling: Vec<usize>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn assign(
    sites: &Sites<'_>,
    retained_lots: &RetainedLots<'_>,
    pr: &mut UrbanProgramme,
    admission: &mut Vec<Vec<bool>>,
    assignments: &mut [Option<usize>],
    memo: &mut Memo,
    reserved_parcels: &impl Fn(&str) -> Vec<usize>,
) -> EarlyAssignments {
    let Sites { layout, part, reserved_for, land_areas, neighbours, center_distances,
        frame, facts, districts, prime, centres, .. } = sites;
    let parcels = &part.parcels;
    let retained = |pi: usize| retained_lots.retains(&parcels[pi]);
    let kept = |pi: usize| retained_lots.allocation(&parcels[pi]);
    let reference = retained_lots.reference;
    // Band 0: user overrides (« éditer une parcelle ») take their lots first,
    // whatever their admission; every later band re-balances around them.
    // Dwelling capacity is counted once the plot household capacity is known.
    let mut forced: Vec<Option<ForcedUse>> = vec![None; parcels.len()];
    if let Some(cfg) = &part.config {
        // A block supplies its parcels' default building type; explicit lot edits win.
        let mut overrides = cfg.overrides.parcels.clone();
        for parcel in parcels.iter() {
            if let Some(role) = cfg.overrides.blocks.get(&parcel.block.to_string()).and_then(|b| b.role.as_ref()).filter(|r| !r.is_empty() && *r != "auto") {
                let edit = overrides.entry(parcel.id.clone()).or_default();
                if edit.role.is_none() && edit.function.is_none() { edit.role = Some(role.clone()); }
            }
        }
        let index: HashMap<&str, usize> = parcels
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.as_str(), i))
            .collect();
        for (id, ov) in &overrides {
            // Shape-only and deletion edits leave the use to the programme.
            if !crate::urban::edits::sets_use(ov) {
                continue;
            }
            let Some(&pi) = index.get(id.as_str()) else {
                pr.warnings.push(warnings::lot_override_missing(id));
                continue;
            };
            // A lot salt draws its use from the admissible demands.
            let drawn = crate::urban::edits::forced_use(ov, id, &pr.demands, |di| {
                eligible_memo(layout, pi, &parcels[pi], &pr.demands[di], pr, memo)
            });
            let Ok(drawn) = drawn.map_err(|w| pr.warnings.push(w)) else {
                continue;
            };
            let ov = &*drawn;
            let Some((di, role)) = override_demand(pr, &part.key, ov) else {
                pr.warnings.push(warnings::lot_override_invalid(id));
                continue;
            };
            admission.resize(pr.demands.len(), vec![false; parcels.len()]);
            assignments[pi] = Some(di);
            forced[pi] = Some((role, ov.households.map(|h| h.min(500.0))));
            if pr.demands[di].unit != "domesticUnits" {
                let cap = capacity(land_areas[pi], &pr.demands[di]);
                pr.demands[di].parcel_capacity += cap;
                if pr.demands[di].id.contains("/demand/override/") {
                    pr.demands[di].requested += cap;
                }
            }
        }
    }
    // Fill the kept slots before any competitive siting. Use their actual
    // allocation, including deliberately vacant gardens and explicit uses.
    if let Some((original, _)) = reference {
        for (pi, slot) in assignments.iter_mut().enumerate() {
            let Some(allocation) = kept(pi).filter(|_| slot.is_none()) else { continue };
            let di = if let Some(di) = pr.demands.iter().position(|d| d.id == allocation.demand_id) {
                di
            } else {
                let Some(source) = original.demands.iter().find(|d| d.id == allocation.demand_id) else { continue };
                let mut source = source.clone();
                source.parcel_capacity = 0.0;
                source.built_capacity = 0.0;
                source.open_capacity = 0.0;
                source.deficit = source.requested;
                if source.role == "open.garden" || source.id.ends_with("/demand/enclosed-open") {
                    source.requested = 0.0;
                }
                let di = pr.demands.len();
                pr.demands.push(source);
                admission.push(vec![false; parcels.len()]);
                di
            };
            *slot = Some(di);
            pr.demands[di].parcel_capacity += allocation.capacity;
            if pr.demands[di].role == "open.garden" || pr.demands[di].id.ends_with("/demand/enclosed-open") {
                pr.demands[di].requested += allocation.capacity;
                pr.demands[di].target_area = pr.demands[di].requested;
            }
        }
        for row in admission.iter_mut() {
            for (pi, admissible) in row.iter_mut().enumerate() {
                // An unchanged plot without an allocation also keeps its use.
                if assignments[pi].is_none() && retained(pi) { *admissible = false; }
            }
        }
    }
    let locked: Vec<bool> = forced.iter().enumerate().map(|(pi, f)| f.is_some() || retained(pi)).collect();
    // Band 1: reserved institutions take their own blocks; legacy area demands
    // (commons, markets without a catalogue) keep the bounded scan.
    let mut order = (0..pr.demands.len()).collect::<Vec<_>>();
    // Admitted parcels per demand, counted once for the sort keys.
    let admitted: Vec<usize> = admission
        .iter()
        .map(|row| row.iter().filter(|&&ok| ok).count())
        .collect();
    order.sort_by_key(|&di| {
        let d = &pr.demands[di];
        (!d.landmark, admitted[di], d.id.clone())
    });
    for &di in &order {
        let d = &pr.demands[di];
        if d.unit == "domesticUnits" || d.placement == "parcel" {
            continue;
        }
        if d.sites > 0 {
            let id = d.id.clone();
            for pi in reserved_parcels(&id) {
                if admission[di][pi] && assignments[pi].is_none() {
                    let cap = capacity(land_areas[pi], &pr.demands[di]);
                    take(pr, assignments, pi, di, cap);
                }
            }
            continue;
        }
        legacy_fill(
            pr,
            di,
            0,
            parcels,
            admission,
            assignments,
            neighbours,
            land_areas,
            center_distances,
            reserved_for,
            &[],
            &locked,
        );
    }
    // Band 2: sited trades and small institutions, distinct and spread plots.
    // A block demand whose reservation failed falls back to the same rule.
    // Trades take at most a share of the plots fit for housing that follows
    // the singular density: 24 % at the default, 4 % at 0, 45 % at most.
    let dwelling = pr
        .demands
        .iter()
        .enumerate()
        .filter(|(_, d)| d.unit == "domesticUnits")
        .map(|(di, _)| di)
        .collect::<Vec<_>>();
    let housing_plots = (0..parcels.len())
        .filter(|&pi| {
            assignments[pi].is_none() && dwelling.iter().any(|&di| admission[di][pi])
        })
        .count();
    // Parcels each demand holds before the sited trades are placed.
    let mut held_by = vec![0usize; pr.demands.len()];
    for &di in assignments.iter().flatten() {
        held_by[di] += 1;
    }
    let density = layout
        .config
        .as_ref()
        .map_or(1.0, |c| c.singular_density)
        .clamp(0.0, 3.0);
    let trade_share = if density.is_finite() { (0.04 + 0.2 * density).min(0.45) } else { 0.24 };
    let mut trade_budget = ((housing_plots as f64 * trade_share).floor() as usize).max(1);
    if reference.is_some() {
        let kept_homes = (0..parcels.len()).filter(|&pi| kept(pi).is_some_and(|a| a.households > 0.0)).count();
        let kept_trades = (0..parcels.len()).filter(|&pi| {
            retained(pi) && assignments[pi].is_some_and(|di| {
                let d = &pr.demands[di];
                d.sites > 0 && d.unit != "domesticUnits" && !reserved_for.contains_key(&parcels[pi].block)
            })
        }).count();
        trade_budget = (((housing_plots + kept_homes) as f64 * trade_share).floor() as usize).max(1)
            .saturating_sub(kept_trades);
    }
    for &di in &order {
        let d = &pr.demands[di];
        if d.sites == 0 || d.unit == "domesticUnits" {
            continue;
        }
        let placed = held_by[di];
        if d.placement == "block" && placed > 0 {
            continue;
        }
        let spacing = frame.radius * 1.6 / (d.sites as f64).sqrt();
        let target = d.target_area.max(1.0);
        // Pure per parcel (the service cost tests the circuits for each): in
        // parallel, in parcel order.
        let free_now = &*assignments;
        let mut candidates: Vec<(usize, f64)> = crate::urban::par::range(parcels.len(), |pi| {
            (free_now[pi].is_none()
                && !retained(pi)
                && (matches!(parcels[pi].use_kind.as_str(), "plot" | "compound")
                    || d.function == "common" && parcels[pi].use_kind == "garden")
                && !reserved_for.contains_key(&parcels[pi].block)
                && roles::site_admissible(&d.site, &facts[pi]))
            .then(|| {
                let district = districts.of(&parcels[pi])
                    .is_some_and(|x| !d.district.is_empty() && x.role.starts_with(&d.district));
                let size = (capacity(land_areas[pi], d) / target).ln().abs().min(3.0);
                // Open uses (cemeteries, commons, orchards) sit behind the
                // street wall, never on a main-street lot a house could take.
                let open_front = d.role.starts_with("open.") && prime[pi];
                (
                    pi,
                    roles::site_cost(&d.site, &facts[pi]) + size * 0.5
                        + crate::urban::fortification::service_cost(layout, d, centres[pi])
                        - if district { 1.0 } else { 0.0 }
                        + if open_front { 2.0 } else { 0.0 },
                )
            })
        })
        .into_iter()
        .flatten()
        .collect();
        // Only the best few hundred admissible candidates compete for the
        // spread penalty; eligibility is tested in cost order until then, so
        // the candidates leave a heap in (cost, index) order instead of being
        // sorted whole.
        let pool = 400 + d.sites * 40;
        let mut kept = Vec::with_capacity(pool);
        let mut by_cost: BinaryHeap<Reverse<Ranked>> = candidates
            .drain(..)
            .map(|(pi, cost)| Reverse(Ranked(cost, pi)))
            .collect();
        while kept.len() < pool {
            let Some(Reverse(Ranked(cost, pi))) = by_cost.pop() else {
                break;
            };
            if eligible_memo(layout, pi, &parcels[pi], d, pr, memo) {
                kept.push((pi, cost));
            }
        }
        // Crowding by already chosen sites, updated once per pick.
        let mut crowd = vec![0.0; kept.len()];
        let mut taken = vec![false; kept.len()];
        let mut chosen: Vec<usize> = vec![];
        for _ in 0..d.sites.saturating_sub(placed).min(trade_budget).min(kept.len()) {
            let best = (0..kept.len())
                .filter(|&k| !taken[k])
                .map(|k| (k, kept[k].1 + 3.0 * crowd[k]))
                .min_by(|a, b| a.1.total_cmp(&b.1).then(kept[a.0].0.cmp(&kept[b.0].0)));
            let Some((k, _)) = best else { break };
            taken[k] = true;
            let q = centres[kept[k].0];
            for (j, c) in kept.iter().enumerate() {
                crowd[j] += (1.0 - dist(centres[c.0], q) / spacing).max(0.0);
            }
            chosen.push(kept[k].0);
            trade_budget -= 1;
        }
        for &pi in &chosen {
            let cap = capacity(land_areas[pi], &pr.demands[di]);
            take(pr, assignments, pi, di, cap);
        }
        if placed + chosen.len() < pr.demands[di].sites {
            let sites = pr.demands[di].sites;
            pr.demands[di].reasons.push(format!(
                "Placed {} of {sites} sites on admissible plots",
                placed + chosen.len()
            ));
        }
    }
    EarlyAssignments { forced, locked, order, dwelling }
}

pub(super) fn reconcile(
    sites: &Sites<'_>,
    pr: &mut UrbanProgramme,
    admission: &[Vec<bool>],
    assignments: &mut [Option<usize>],
    early: &EarlyAssignments,
    households: &[f64],
) {
    let Sites { part, prime, neighbours, land_areas, center_distances, reserved_for, .. } = sites;
    let parcels = &part.parcels;
    let EarlyAssignments { order, locked, .. } = early;
    // Lots kept by the second pass: user edits and the main-street wall.
    let keep: Vec<bool> = (0..parcels.len())
        .map(|pi| locked[pi] || (prime[pi] && assignments[pi].is_some()))
        .collect();
    // Bounded second pass: constrained legacy demands may still relocate an
    // oversupplied dwelling. Never displace a reservation or a sited role.
    for &di in order {
        let d = &pr.demands[di];
        if d.sites > 0 || d.unit == "domesticUnits" {
            continue;
        }
        legacy_fill(
            pr,
            di,
            1,
            parcels,
            admission,
            assignments,
            neighbours,
            land_areas,
            center_distances,
            reserved_for,
            households,
            &keep,
        );
    }
    pr.reconciliation_passes = 2;
}

struct Ranked(f64, usize);
impl PartialEq for Ranked {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}
impl Eq for Ranked {}
impl PartialOrd for Ranked {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Ranked {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&other.0).then(self.1.cmp(&other.1))
    }
}
/// The demand reserved on each block, by block index (the last reservation of
/// a block wins).
/// Demand absorbing a user-forced lot: the existing demand of that role (or the
/// town's housing for a dwelling type), else a new `override` demand sized by
/// the lots it receives. `None` when the override is malformed.
fn override_demand(
    pr: &mut UrbanProgramme,
    key: &str,
    ov: &ParcelOverride,
) -> Option<(usize, String)> {
    const FUNCTIONS: [&str; 7] = [
        "domestic",
        "mixed",
        "workshop",
        "warehouse",
        "collective",
        "market",
        "common",
    ];
    let valid = |r: &String| {
        (1..=64).contains(&r.len())
            && r.chars()
                .all(|c| c.is_ascii_alphanumeric() || ".:-_".contains(c))
    };
    if ov.role.as_ref().is_some_and(|r| !valid(r))
        || ov
            .function
            .as_ref()
            .is_some_and(|f| !FUNCTIONS.contains(&f.as_str()))
        || ov.households.is_some_and(|h| !h.is_finite() || h < 0.0)
    {
        return None;
    }
    let role = ov.role.clone();
    let function = ov
        .function
        .clone()
        .or_else(|| {
            let r = role.as_deref()?;
            pr.demands
                .iter()
                .find(|d| d.role == r)
                .map(|d| d.function.clone())
                .or_else(|| roles::role_function(r).map(str::to_owned))
        })
        .unwrap_or_else(|| {
            match role.as_deref().unwrap_or("dwelling") {
                r if r.starts_with("dwelling.shop") => "mixed",
                r if r.starts_with("dwelling") => "domestic",
                r if r.starts_with("open.") => "common",
                r if r.starts_with("craft.") => "workshop",
                r if r.starts_with("storage.") => "warehouse",
                _ => "collective",
            }
            .into()
        });
    let role = role.unwrap_or_else(|| default_role(&function).into());
    let dwelling = matches!(function.as_str(), "domestic" | "mixed");
    if let Some(di) = pr
        .demands
        .iter()
        .position(|d| d.role == role && d.function == function)
        .or_else(|| {
            dwelling
                .then(|| {
                    pr.demands
                        .iter()
                        .position(|d| d.unit == "domesticUnits" && d.function == function)
                })
                .flatten()
        })
    {
        return Some((di, role));
    }
    let id = format!("{key}/demand/override/{role}");
    if let Some(di) = pr.demands.iter().position(|d| d.id == id) {
        return Some((di, role));
    }
    let mut d = demand(
        key,
        &function,
        0.0,
        dwelling,
        "Surcharge utilisateur".into(),
    );
    d.id = id;
    d.role = role.clone();
    d.placement = "parcel".into();
    d.landmark = roles::is_landmark(&role);
    pr.demands.push(d);
    Some((pr.demands.len() - 1, role))
}

/// Area-driven fill for legacy demands (commons, warehouses, resource workshops):
/// most-cohesive admissible plot first, reserved plots of the demand before all.
#[allow(clippy::too_many_arguments)]
fn legacy_fill(
    pr: &mut UrbanProgramme,
    di: usize,
    pass: usize,
    parcels: &[Parcel],
    admission: &[Vec<bool>],
    assignments: &mut [Option<usize>],
    neighbours: &[Vec<usize>],
    land_areas: &[f64],
    center_distances: &[f64],
    reserved_for: &ReservedFor,
    units: &[f64],
    locked: &[bool],
) {
    // The admitted plots, in index order: an attempt visits these only.
    let admitted: Vec<usize> = (0..parcels.len()).filter(|&pi| admission[di][pi]).collect();
    // Each successful attempt claims a previously unassigned/relocatable plot.
    for _ in 0..parcels.len() {
        if pr.demands[di].parcel_capacity + 0.01 >= pr.demands[di].requested { break; }
        let d = &pr.demands[di];
        let options = admitted
            .iter()
            .filter_map(|&pi| {
                let p = &parcels[pi];
                let prior = assignments[pi];
                if prior.is_some() && locked.get(pi) == Some(&true) {
                    return None;
                }
                // The bounded second pass can relocate a flexible, oversupplied
                // domestic/mixed allocation. Never displace a constraint/reserve.
                if let Some(old) = prior
                    && (pass == 0
                        || old == di
                        || !matches!(pr.demands[old].function.as_str(), "domestic" | "mixed")
                        || pr.demands[old].parcel_capacity - units.get(pi).copied().unwrap_or(1.0)
                            + 0.01
                            < pr.demands[old].requested)
                {
                    return None;
                }
                let cap = capacity(land_areas[pi], d);
                if cap <= 0.0 {
                    return None;
                }
                let coh = neighbours[pi]
                    .iter()
                    .filter(|&&j| assignments[j] == Some(di))
                    .count() as f64;
                let center = center_distances[pi];
                let front = p.access.as_ref().map_or(0.0, |a| a.front_length);
                let commercial = matches!(d.function.as_str(), "mixed" | "market" | "warehouse");
                let score = coh * 2.0
                    + p.pressure * if commercial { 3.0 } else { 0.5 }
                    + front.min(30.0) * if commercial { 0.15 } else { 0.02 }
                    - center / if commercial { 250.0 } else { 1500.0 }
                    - (cap - (d.requested - d.parcel_capacity)).max(0.0) / d.requested.max(1.0);
                // Retained reservations satisfy their own demand first.
                // Their access is carried by exact contacts, while the
                // cadastral access field intentionally remains reserved.
                let reserved = reserved_for.get(&p.block).is_some_and(|id| *id == d.id);
                Some((pi, score, reserved))
            })
            .collect::<Vec<_>>();
        let chosen = options.into_iter().max_by(|a, b| {
            a.2.cmp(&b.2)
                .then_with(|| a.1.total_cmp(&b.1))
                .then_with(|| parcels[b.0].id.cmp(&parcels[a.0].id))
        });
        let Some((pi, _, _)) = chosen else {
            break;
        };
        if let Some(old) = assignments[pi] {
            pr.demands[old].parcel_capacity -= units.get(pi).copied().unwrap_or(1.0);
        }
        assignments[pi] = Some(di);
        pr.demands[di].parcel_capacity += capacity(land_areas[pi], &pr.demands[di]);
    }
}
