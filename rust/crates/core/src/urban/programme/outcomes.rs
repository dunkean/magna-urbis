//! Unbuilt land uses, allocation records and settlement condition and capacity reporting.

use crate::urban::{Layout, Partition, culture::CultureMapping, roles::{self, SiteFacts}, warnings};
use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::{Allocation, UrbanProgramme, admission::Memo, allocation::{RetainedLots, Sites, take},
    demand::{STYLE, capacity, demand}, districts::{dwelling_role, farm_share},
    environment::parcel_culture, household_population, housing::Housing, services::EarlyAssignments};

#[allow(clippy::too_many_arguments)]
pub(super) fn record(
    sites: &Sites<'_>,
    retained_lots: &RetainedLots<'_>,
    pr: &mut UrbanProgramme,
    assignments: &mut [Option<usize>],
    memo: &mut Memo,
    early: &EarlyAssignments,
    housing: &Housing,
    lap: &impl Fn(&str),
) {
    let Sites { layout, part, land_areas, reserved_for, enclosed, neighbours, facts, districts, .. } = sites;
    let parcels = &part.parcels;
    let EarlyAssignments { forced, locked, .. } = early;
    let Housing { households, extra_households, tower_households } = housing;
    let retained = |pi: usize| retained_lots.retains(&parcels[pi]);
    let kept = |pi: usize| retained_lots.allocation(&parcels[pi]);
    // Band 5: every plot left over is an explicit garden, orchard or yard.
    // A substantial wall-side verge also needs a cultural land use, even when
    // its width rules out a house. Only small incidental verges stay unallocated.
    // An isolated site is one intention: its other land stays as it is.
    let isolated = roles::is_isolated(&pr.context.intent);
    let gardens: Vec<usize> = (0..parcels.len())
        .filter(|&pi| {
            !isolated
                && assignments[pi].is_none()
                && !retained(pi)
                && (matches!(parcels[pi].use_kind.as_str(), "plot" | "compound")
                    || parcels[pi].use_kind == "garden" && parcels[pi].family != "reserve"
                        && parcels[pi].reason != "camp-open"
                        && parcels[pi].access.as_ref().is_none_or(|a| a.kind != "private")
                    || parcels[pi].use_kind == "common" && parcels[pi].reason == "common:verge"
                        && land_areas[pi] >= crate::urban::trim::SMALL_VERGE_AREA)
                && !reserved_for.contains_key(&parcels[pi].block)
                && pr.environment.get(parcels[pi].block).is_none_or(|e| !e.wet)
        })
        .collect();
    if !gardens.is_empty() {
        let total: f64 = gardens.iter().map(|&pi| land_areas[pi]).sum();
        let id = format!("{}/demand/garden", part.key);
        let gi = if let Some(gi) = pr.demands.iter().position(|d| d.id == id) {
            pr.demands[gi].requested += total;
            pr.demands[gi].target_area += total;
            gi
        } else {
            let mut g = demand(
                &part.key,
                "common",
                total,
                false,
                "Remainder of buildable plots after housing: private gardens and yards".into(),
            );
            g.id = id;
            g.role = "open.garden".into();
            let gi = pr.demands.len();
            pr.demands.push(g);
            gi
        };
        for &pi in &gardens {
            take(pr, assignments, pi, gi, land_areas[pi]);
        }
    }
    // Land a circuit keeps open is a land use, not a blank: a block nobody
    // builds on and the field plots at the back of a deep block take the
    // open role of the culture's enclosures (`core.enclosure.open`).
    let enclosed_open: Vec<usize> = (0..parcels.len())
        .filter(|&pi| {
            !isolated
                && assignments[pi].is_none()
                && !retained(pi)
                && enclosed[pi]
                && parcels[pi].family == "reserve"
                && (parcels[pi].use_kind == "reserve" && parcels[pi].reason == "reserve"
                    || matches!(parcels[pi].reason.as_str(), "backland-field" | "public-garden" | "enclosed-common"))
                && !reserved_for.contains_key(&parcels[pi].block)
                && pr.environment.get(parcels[pi].block).is_none_or(|e| !e.wet)
        })
        .collect();
    if !enclosed_open.is_empty() {
        let total: f64 = enclosed_open.iter().map(|&pi| land_areas[pi]).sum();
        let id = format!("{}/demand/enclosed-open", part.key);
        let di = if let Some(di) = pr.demands.iter().position(|d| d.id == id) {
            pr.demands[di].requested += total;
            pr.demands[di].target_area += total;
            di
        } else {
            let mut d = demand(
                &part.key,
                "common",
                total,
                false,
                "Unbuilt land kept inside the circuit: the open land of the culture's enclosures".into(),
            );
            d.id = id;
            d.role = crate::urban::composition::enclosed_open(&layout.culture, pr.population).0.into();
            let di = pr.demands.len();
            pr.demands.push(d);
            di
        };
        for &pi in &enclosed_open {
            take(pr, assignments, pi, di, land_areas[pi]);
        }
    }
    // Parcel of each allocation, in allocation order.
    let mut allocation_parcels: Vec<usize> = Vec::with_capacity(parcels.len());
    for (pi, &assignment) in assignments.iter().enumerate() {
        let Some(di) = assignment else { continue };
        if let Some(allocation) = kept(pi) {
            pr.allocations.push(allocation.clone());
            allocation_parcels.push(pi);
            continue;
        }
        let p = &parcels[pi];
        let d = &pr.demands[di];
        // Gardens need no building recipe; they keep the parcel's cultural route.
        let user = forced[pi].as_ref();
        let found = memo.mapping(layout, pi, p, &d.function).is_some();
        let fallback: Option<CultureMapping>;
        let c: &CultureMapping = if found {
            memo.mapping(layout, pi, p, &d.function).expect("mapping memoised above")
        } else if d.role == "open.garden" || user.is_some() {
            if memo.mapping(layout, pi, p, "domestic").is_some() {
                memo.mapping(layout, pi, p, "domestic").expect("mapping memoised above")
            } else {
                fallback = crate::urban::culture::mapping_for(parcel_culture(layout, p), &pr.context.period);
                match &fallback {
                    Some(c) => c,
                    None => continue,
                }
            }
        } else {
            continue;
        };
        let same = neighbours[pi]
            .iter()
            .filter(|&&j| assignments[j] == Some(di))
            .count();
        let district = districts.of(p);
        let dwelling = d.unit == "domesticUnits";
        let held = match user.and_then(|u| u.1) {
            Some(h) => h,
            None if dwelling && extra_households[pi] => 1.0,
            None if dwelling => households[pi].max(1.0),
            None => tower_households[pi],
        };
        // An isolated establishment keeps the role of its intent (a lone farm
        // is a farm whatever its lot's draw).
        let role = if let Some((r, _)) = user {
            r.clone()
        } else if dwelling && d.function == "domestic" && !roles::is_isolated(&pr.context.intent) {
            dwelling_role(
                c,
                held,
                land_areas[pi],
                district.map(|x| (x.role.as_str(), x.wealth)),
                (crate::settlements::demographics::below(pr.population, "town") || layout.blocks.get(p.block).is_some_and(|b| b.zone == "village"))
                    .then(|| farm_share(pr.population, p.pressure, &p.id)),
            )
        } else {
            d.role.clone()
        };
        let mut reasons = vec![
            "Admissible access and envelope".into(),
            format!("Native tissue recipe:{}", c.admissibility.recipe_id),
            format!("{} true edge neighbours", neighbours[pi].len()),
        ];
        if user.is_some() {
            reasons.insert(0, "Surcharge utilisateur".into());
        }
        // A demand of another culture (style sheet) is built in that culture,
        // when the programme applies it (invariant: an allocation's culture
        // is one of the programme's); else in the lot's own.
        let style = d
            .provenance
            .iter()
            .find_map(|p| p.strip_prefix(STYLE))
            .filter(|s| pr.cultures.iter().any(|c| c.culture == *s));
        pr.allocations.push(Allocation {
            parcel_id: p.id.clone(),
            demand_id: d.id.clone(),
            function: d.function.clone(),
            culture: style.map_or_else(|| c.culture.clone(), str::to_owned),
            architecture_pack: style
                .and_then(crate::urban::culture::architecture_pack)
                .map_or_else(|| c.architecture_pack.clone(), str::to_owned),
            capacity: if dwelling {
                held
            } else {
                capacity(land_areas[pi], d)
            },
            unit: d.unit.clone(),
            score: same as f64,
            reasons,
            landmark: d.landmark || (user.is_some() && roles::is_landmark(&role)),
            label: String::new(),
            role,
            households: held,
            residents: None,
            housing_floor_need: if dwelling && matches!(d.function.as_str(), "domestic" | "mixed") {
                roles::indicative_housing_floor_need(&c.culture, held, district.map_or(0.5, |x| x.wealth))
            } else { None },
            district_role: district.map_or_else(String::new, |x| x.role.clone()),
            wealth: district.map_or(0.5, |x| x.wealth),
        });
        allocation_parcels.push(pi);
    }
    lap("gardens");
    decay(pr, &allocation_parcels, facts, locked);
    culture_ruins(pr, &allocation_parcels, locked);
    household_population::assign(pr);
    // Labels depend on (role, culture) only: one lookup per pair.
    let labels: Vec<String> = {
        let mut known: HashMap<(&str, &str), String> = HashMap::new();
        pr.allocations
            .iter()
            .map(|a| {
                known
                    .entry((a.role.as_str(), a.culture.as_str()))
                    .or_insert_with(|| roles::label(&a.role, &a.culture))
                    .clone()
            })
            .collect()
    };
    for (a, label) in pr.allocations.iter_mut().zip(labels) {
        a.label = label;
    }
    for d in &mut pr.demands {
        // Deficit here is the actual unbuilt demand. A separate land deficit is
        // displayed via requested - parcelCapacity until placements reconcile it.
        d.deficit = (d.requested - d.built_capacity).max(0.0);
        if d.sites == 0 && d.parcel_capacity + 0.01 < d.requested {
            d.reasons
                .push("Insufficient admissible parcel capacity after two allocation passes".into());
        }
    }
    if pr.context.mode == "strict" && pr.cultures.iter().any(|c| !c.borrowing.is_empty()) {
        pr.warnings.push(warnings::strict_cultural_borrowing());
    }
}


pub(super) fn finish(
    layout: &Layout,
    partition: &mut Partition,
    mut pr: UrbanProgramme,
    reference: Option<(&UrbanProgramme, &BTreeSet<String>)>,
) {
    // Report the estimated capacity and log the steps and limits of the plan.
    if let Some(plan) = crate::urban::footprint::capacity::of(layout) {
        let (wanted, housed) = pr
            .demands
            .iter()
            .filter(|d| d.unit == "domesticUnits")
            .fold((0.0, 0.0), |(w, h), d| {
                (w + d.requested, h + d.parcel_capacity.min(d.requested))
            });
        let mut steps = crate::urban::footprint::capacity::describe(&layout.culture, plan);
        let share = if wanted > 0.0 { housed / wanted } else { 1.0 };
        if std::env::var("URBAN_CAPACITY_DEBUG").is_ok() {
            // Prediction error of the shared estimator: footprint forecast and
            // block measure against the parcels' real household capacity.
            eprintln!(
                "{}",
                serde_json::json!({
                    "capacity": layout.culture,
                    "population": pr.population,
                    "required": plan.required.round(),
                    "forecast": plan.forecast.round(),
                    "measured": plan.predicted.round(),
                    "real": pr.housing_capacity.round(),
                    "densify": plan.densify,
                    "extension": plan.extension,
                    "donor": plan.donor,
                    "borrowed": plan.borrowed_share,
                    "vacancy": plan.vacancy,
                })
            );
        }
        if share < 0.95 {
            // Bounds reached (densified, widest land, borrowed everywhere a
            // donor exists) or terrain; else the tissue measured below its
            // probed forecast and the plan stopped short of its bounds.
            let bounded = plan.densify >= 0.999
                && (plan.borrowed_share >= 0.999
                    || (plan.donor.is_empty()
                        && plan.extension >= crate::urban::footprint::capacity::EXTENSION - 0.01));
            steps.push(warnings::warning_detail_text(format_args!(
                "Shortfall of {:.0} households: {}",
                wanted - housed,
                if bounded {
                    "terrain or cultural limits constrain capacity"
                } else {
                    "the estimate from actual lots is below the tissue forecast"
                }
            )));
        }
        if !steps.is_empty() {
            partition.warnings.push(warnings::parcel_capacity((share * 100.0).floor(), &steps));
        }
    }
    // A small village is cut to the lots its programme fills: a block that received no
    // building at all is open land (garden, field), not a built quarter standing empty.
    if pr.population < 1200 {
        let used: std::collections::HashSet<&str> = pr
            .allocations
            .iter()
            .map(|a| a.parcel_id.as_str())
            .collect();
        let mut built = vec![false; layout.blocks.len()];
        for p in &partition.parcels {
            if used.contains(p.id.as_str()) && p.block < built.len() {
                built[p.block] = true;
            }
        }
        for p in &mut partition.parcels {
            let open = layout.blocks.get(p.block).is_some_and(|b| b.kind == "block");
            if open && !built[p.block] && matches!(p.use_kind.as_str(), "plot" | "residual")
                && reference.is_none_or(|(_, keep)| !keep.contains(&p.id))
            {
                p.use_kind = "garden".into();
                p.reason = "unbuilt-block".into();
            }
        }
    }
    count_outcomes(partition, &mut pr);
    crate::urban::generation_limits::report_population(&mut pr, false);
    partition.warnings.retain(|w| !warnings::is_population_shortfall(w));
    partition.warnings.extend(pr.warnings.iter().filter(|w| warnings::is_population_shortfall(w)).cloned());
    partition.programme = Some(pr);
    crate::urban::springs::allocate(layout, partition);
}

/// Distinct sites holding each counted role (`UrbanProgramme::counts`): a
/// reserved block is one site whatever its lots, any other plot is one. A
/// forced count left short adds a warning; a suggested one stays silent.
pub(super) fn count_outcomes(partition: &mut Partition, pr: &mut UrbanProgramme) {
    partition.warnings.retain(|w| !warnings::is_count_shortfall(w));
    if pr.counts.is_empty() {
        return;
    }
    let block_of: HashMap<&str, usize> = partition.parcels.iter().map(|p| (p.id.as_str(), p.block)).collect();
    let role_of: HashMap<&str, &str> = pr.demands.iter().map(|d| (d.id.as_str(), d.role.as_str())).collect();
    let reserved: BTreeSet<(&str, usize)> = pr.reservations.iter().map(|r| (r.demand_id.as_str(), r.block)).collect();
    let mut sites: BTreeMap<&str, BTreeSet<(usize, &str)>> = BTreeMap::new();
    for r in &pr.reservations {
        if let Some(&role) = role_of.get(r.demand_id.as_str()) {
            sites.entry(role).or_default().insert((r.block, ""));
        }
    }
    for a in &pr.allocations {
        let Some(&role) = role_of.get(a.demand_id.as_str()) else { continue };
        let in_reserve = block_of.get(a.parcel_id.as_str()).is_some_and(|&b| reserved.contains(&(a.demand_id.as_str(), b)));
        if !in_reserve {
            sites.entry(role).or_default().insert((usize::MAX, a.parcel_id.as_str()));
        }
    }
    let force = pr.context.count_mode == "force";
    let mut short = vec![];
    for row in &mut pr.counts {
        row.placed = sites.get(row.role.as_str()).map_or(0, |s| s.len() as u32);
        if let Some(n) = row.requested.filter(|&n| force && row.placed < n) {
            short.push(warnings::programme_count_short(&row.role, row.placed, n));
        }
    }
    partition.warnings.extend(short.iter().cloned());
    pr.warnings.retain(|w| !warnings::is_count_shortfall(w));
    pr.warnings.extend(short);
}

/// Settlement state (`services.json` states): a share of the built lots
/// stands empty or ruined, peripheral and low-traffic lots first; a fully
/// abandoned place leaves its gardens fallow. Empty buildings keep their lot,
/// function and form so houses and the UI can draw them as such.
fn decay(pr: &mut UrbanProgramme, allocation_parcels: &[usize], facts: &[SiteFacts], locked: &[bool]) {
    let Some(rule) = roles::state(&pr.context.state).filter(|r| !r.suffix.is_empty()) else {
        return;
    };
    let ratio = pr.context.decay.unwrap_or(rule.decay).clamp(0.0, 1.0);
    let all = ratio >= 0.999;
    let mut built: Vec<(usize, f64)> = pr
        .allocations
        .iter()
        .enumerate()
        .filter_map(|(ai, a)| {
            let pi = *allocation_parcels.get(ai)?;
            let keep = a.role == "open.garden" || (!all && (a.landmark || locked[pi]));
            (!keep).then(|| (ai, facts[pi].core - facts[pi].pressure))
        })
        .collect();
    built.sort_by(|a, b| {
        b.1.total_cmp(&a.1).then_with(|| {
            pr.allocations[a.0]
                .parcel_id
                .cmp(&pr.allocations[b.0].parcel_id)
        })
    });
    let count = (ratio * built.len() as f64).round() as usize;
    for &(ai, _) in built.iter().take(count) {
        let a = &mut pr.allocations[ai];
        a.role.push_str(&rule.suffix);
        a.households = 0.0;
        a.residents = Some(0.);
        a.housing_floor_need = None;
        if a.unit == "domesticUnits" {
            a.capacity = 0.0;
        }
    }
    if all {
        for a in pr
            .allocations
            .iter_mut()
            .filter(|a| a.role == "open.garden")
        {
            a.role = "open.fallow".into();
        }
    }
}
/// Culture ruins (`roles::ruin_share` by demographic class): a share of the
/// built lots of each culture stands in ruins, ranked by each lot's own seed
/// so ruins scatter among the inhabited houses; landmarks and locked lots
/// stand, and a lone building never falls. Like the state's decay, it empties
/// homes of the plan sized for the whole population.
fn culture_ruins(pr: &mut UrbanProgramme, allocation_parcels: &[usize], locked: &[bool]) {
    // An explicit vacancy of 0 asks for no empty building at all (capacity probes).
    if pr.context.decay == Some(0.0) {
        return;
    }
    let class = crate::settlements::demographics::class_of(pr.population);
    let mut by_culture: BTreeMap<String, Vec<(f64, usize)>> = BTreeMap::new();
    for (ai, a) in pr.allocations.iter().enumerate() {
        let Some(&pi) = allocation_parcels.get(ai) else { continue };
        if a.landmark || locked[pi] || a.role.ends_with(".ruin") || a.role.ends_with(".abandoned")
            || !matches!(a.function.as_str(), "domestic" | "mixed" | "workshop" | "warehouse") || roles::ruin_share(&a.culture, class) <= 0.0 {
            continue;
        }
        let rank = crate::rng::Rng::new(&a.parcel_id).fork("culture-ruin").float();
        by_culture.entry(a.culture.clone()).or_default().push((rank, ai));
    }
    for (culture, mut lots) in by_culture {
        lots.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let count = (roles::ruin_share(&culture, class) * lots.len() as f64).floor() as usize;
        for &(_, ai) in lots.iter().take(count) {
            let a = &mut pr.allocations[ai];
            a.role.push_str(".ruin");
            a.households = 0.0;
            a.residents = Some(0.);
            a.housing_floor_need = None;
            if a.unit == "domesticUnits" {
                a.capacity = 0.0;
            }
        }
    }
}
