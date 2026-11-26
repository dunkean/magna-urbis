//! Household capacity, placement of shops and homes, and frontage infill.

use crate::urban::{Parcel, culture::mapping, roles, warnings};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap, HashMap};

use super::{UrbanProgramme, admission::{Memo, eligible_memo}, allocation::{RetainedLots, Sites, take},
    camps, environment::parcel_culture, services::EarlyAssignments};

pub(super) struct Housing {
    pub(super) households: Vec<f64>,
    pub(super) tower_households: Vec<f64>,
    pub(super) extra_households: Vec<bool>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn assign(
    sites: &Sites<'_>,
    retained_lots: &RetainedLots<'_>,
    pr: &mut UrbanProgramme,
    admission: &[Vec<bool>],
    assignments: &mut [Option<usize>],
    memo: &mut Memo,
    early: &mut EarlyAssignments,
    lap: &impl Fn(&str),
) -> Housing {
    let Sites { layout, part, land_areas, centres, center_distances, prime, enclosed,
        neighbours, districts, .. } = sites;
    let parcels = &part.parcels;
    let EarlyAssignments { forced, locked, dwelling, .. } = early;
    let retained = |pi: usize| retained_lots.retains(&parcels[pi]);
    let kept = |pi: usize| retained_lots.allocation(&parcels[pi]);
    // Households per plot from floor area, floors and the cultural occupancy.
    let occupancy = roles::occupancy(&layout.culture);
    // A village stays one ordinary household per plot even inside a wall,
    // where its tissue is labelled `core`. Shared by footprint probes and
    // real allocation; farm buildings never stand for additional households.
    let village = crate::settlements::demographics::below(pr.population, "town") || camps::camp(layout, pr.population)
        || mapping(&layout.culture).is_some_and(|m| m.functional_profile == "communal");
    // Tissue of a (block, culture): resolved once, with its storey cap.
    #[derive(Clone, Copy)]
    struct Tissue {
        coverage: f64,
        longhouse: bool,
        /// A declared apartment or tenement typology: several households per
        /// building at any settlement size, like a longhouse.
        collective: bool,
        /// Floor (m²) of the communal house the culture declares (`campHouse`), 0 when it
        /// declares none: the roof's household limit (`roof_households`).
        house: f64,
        households: Option<f64>,
        cap: Option<u32>,
        storeys: [f64; 2],
    }
    // Keyed by block, culture and the lot's dithered zone (`zone_blend::lot_zone`),
    // and resolved from the first housing lot of each key, in parcel order.
    type TissueKey<'a> = (usize, &'a str, Option<&'a str>);
    let keys: Vec<Option<TissueKey<'_>>> = crate::urban::par::map(parcels, |pi, p| {
        dwelling.iter().any(|&di| admission[di][pi])
            .then(|| (p.block, parcel_culture(layout, p), crate::urban::zone_blend::lot_zone(layout, p)))
    });
    let mut slots: HashMap<TissueKey<'_>, usize> = HashMap::new();
    let mut firsts: Vec<usize> = vec![];
    let tissue_slot: Vec<Option<usize>> = keys.iter().enumerate().map(|(pi, key)| key.map(|k| *slots.entry(k).or_insert_with(|| {
        firsts.push(pi);
        firsts.len() - 1
    }))).collect();
    // Each tissue is a pure function of its key's first lot: in parallel.
    let tissues: Vec<Tissue> = crate::urban::par::map(&firsts, |_, &pi| {
            let p = &parcels[pi];
            let culture = parcel_culture(layout, p);
            {
                let (coverage, raw, (longhouse, collective, house), households, blend) =
                    crate::urban::culture::lot_morph(layout, part, culture, p)
                        .map(|(zone, m)| {
                            let c = crate::urban::zone_blend::coverage(&m, zone);
                            let s = &m.value["arch"]["storeys"];
                            let typology = m.value["arch"]["typology"].as_str().unwrap_or("");
                            (
                                ((c[0] + c[1]) * 0.5).clamp(0.2, 0.95),
                                [s[0].as_f64().unwrap_or(1.0), s[1].as_f64().unwrap_or(1.0)],
                                (matches!(typology, "longhouse" | "maloca" | "plank-house"), COLLECTIVE_TYPOLOGIES.contains(&typology),
                                    { let [w, l] = m.pair("campHouse"); if w > 0.0 && l > 0.0 { w * l } else { 0.0 } }),
                                camps::households_per_house(&m),
                                crate::urban::zone_blend::storeys_of(&m.value["arch"]),
                            )
                        })
                        .unwrap_or((0.5, [1.0, 1.0], (false, false, 0.0), None, None));
                // The style's height ladder caps the storeys as massing.rs does.
                let cap = crate::urban::forms::kit::storey_cap(culture, pr.population, crate::urban::massing::user_core(layout, p.block));
                let capped = |r: [f64; 2]| crate::urban::forms::kit::capped_storeys([r[0] as u32, r[1] as u32], cap).map(f64::from);
                // Near another phase (`zoneDensity: gradient`) the range leans toward its storeys.
                let storeys = crate::urban::zone_blend::mix(capped(raw), blend.map(|(w, o)| (w, capped(o))));
                Tissue { coverage, longhouse, collective, house, households, cap, storeys }
            }
    });
    let densify = crate::urban::footprint::capacity::of(layout)
        .filter(|_| {
            part.config
                .as_ref()
                .is_none_or(crate::urban::footprint::capacity::parcels_enabled)
        })
        .map_or(0.0, |c| c.densify);
    let household_caps = parcels
        .iter()
        .enumerate()
        .map(|(pi, p)| {
            let Some(slot) = tissue_slot[pi] else {
                return 0.0;
            };
            let tissue = tissues[slot];
            let zone_village = layout
                .blocks
                .get(p.block)
                .is_some_and(|b| b.zone == "village");
            let limits = memo
                .mapping(layout, pi, p, "domestic")
                .map_or([1, 1], |c| c.admissibility.floors);
            // A densified tissue (adaptive capacity) raises the floors toward
            // the upper bound its houses admit, never past it.
            let (cap, storeys) = (tissue.cap, tissue.storeys);
            let drawn = storeys[0] + (storeys[1] - storeys[0]) * p.pressure.clamp(0.0, 1.0);
            let top = f64::from(limits[1].max(limits[0])).min(cap.map_or(f64::MAX, f64::from));
            let floors = (drawn + (top - drawn).max(0.0) * densify)
                .round()
                .clamp(f64::from(limits[0]).min(top), top);
            let capacity = household_capacity(
                land_areas[pi],
                tissue.coverage,
                floors,
                &occupancy,
                districts.of(p).map_or(0.5, |d| d.wealth),
                (village || zone_village) && !tissue.longhouse && !tissue.collective,
                pr.population,
                tissue.longhouse || tissue.collective,
                p.pressure,
            );
            // A communal house holds what its roof credibly shelters, however large its lot.
            let capacity = if tissue.longhouse { capacity.min(roof_households(tissue.house, &occupancy)) } else { capacity };
            tissue.households.unwrap_or(capacity)
        })
        .collect::<Vec<_>>();
    // Forced dwellings hold their stated households (else the plot capacity).
    for pi in 0..parcels.len() {
        if let (Some(di), Some(f)) = (assignments[pi], forced[pi].as_mut())
            && pr.demands[di].unit == "domesticUnits"
        {
            let held = *f.1.get_or_insert(household_caps[pi].max(1.0));
            pr.demands[di].parcel_capacity += held;
        }
    }
    // Housing towers and slabs (`housing.*` service roles) below city size hold
    // a few households only: together `roles::tower_home_share` of the
    // programme, counted against its domestic demand, so the town lives in its
    // ordinary homes and the tower is mostly offices, shops and landmark.
    let mut tower_households = vec![0.0; parcels.len()];
    let towers: Vec<usize> = (0..parcels.len())
        .filter(|&pi| !locked[pi] && assignments[pi].is_some_and(|di|
            pr.demands[di].role.starts_with("housing.") && pr.demands[di].unit != "domesticUnits"))
        .collect();
    if let Some(&home) = dwelling.iter().find(|&&di| pr.demands[di].function == "domestic") {
        let asked: f64 = dwelling.iter().map(|&di| pr.demands[di].requested).sum();
        let kept_tower_homes: f64 = (0..parcels.len()).filter_map(kept)
            .filter(|a| a.role.starts_with("housing.") && a.unit != "domesticUnits")
            .map(|a| a.households).sum();
        pr.demands[home].parcel_capacity += kept_tower_homes;
        if !towers.is_empty() {
            let room = roles::tower_home_share(pr.population) * asked - kept_tower_homes;
            let each = (room / towers.len() as f64).floor();
            if each >= 1.0 {
                for &pi in &towers { tower_households[pi] = each; }
                pr.demands[home].parcel_capacity += each * towers.len() as f64;
            }
        }
    }
    pr.housing_capacity = household_caps.iter().sum();
    lap("capacity");
    // Spread the households over the land actually left: dense where land is
    // short, one household per plot (and gardens for the rest) where it abounds.
    let wanted: f64 = dwelling
        .iter()
        .map(|&di| (pr.demands[di].requested - pr.demands[di].parcel_capacity).max(0.0))
        .sum();
    let supply: f64 = (0..parcels.len())
        .filter(|&pi| assignments[pi].is_none() && !retained(pi))
        .map(|pi| household_caps[pi])
        .sum();
    let free = assignments.iter().map(Option::is_none).collect::<Vec<_>>();
    let pressures = parcels.iter().map(|p| p.pressure).collect::<Vec<_>>();
    let mut households = spread_households(&household_caps, &pressures, &free, wanted.ceil(),
        crate::urban::zone_blend::enabled(layout).then_some(&land_areas[..]));
    for (pi, homes) in households.iter_mut().enumerate() {
        if let Some(allocation) = kept(pi) {
            *homes = allocation.households;
        }
    }
    // Band 3 and 4: shops first but only for their share of the land actually
    // left, then housing; shops can no longer starve households.
    let short = if wanted > 0.0 {
        (supply / wanted).min(1.0)
    } else {
        1.0
    };
    let mut extra_households = vec![false; parcels.len()];
    let requested: f64 = dwelling.iter().map(|&di| pr.demands[di].requested).sum();
    // Population margin of the infill of serviced land, the same one the land
    // plan reserved (`roles::housing_margin`): 5 % in villages, 15 % in towns,
    // 30 % in large cities.
    let fill_limit = (requested * roles::housing_margin(pr.population)).floor().max(requested.ceil());
    // Core standing of each block: 1 or 0 by zone, shared across a phase
    // boundary with `zoneDensity: gradient` (`zone_blend::core_weight`).
    let zone_blends = crate::urban::zone_blend::blocks(layout);
    let core_weight = |block: usize| crate::urban::zone_blend::core_weight(layout, zone_blends.get(block).copied().flatten(), block);
    // A served lot: a street door, not rear land nor a reserved compound.
    let served = |pi: usize| parcels[pi].access.as_ref().is_some_and(|a| !matches!(a.kind.as_str(), "attached" | "reserved"));
    // Population cap of the saturating infill: 30 % over the programme (the
    // fill limit itself in a large city or on an isolated site). The number of
    // homes is the land plan's (`footprint::capacity` reserves the housing
    // margin): the cap only binds when the cut strays far above the plan.
    let population_cap = if roles::is_isolated(&pr.context.intent) { fill_limit } else { (requested * 1.3).floor().max(fill_limit) };
    // Seed the blocks, enclosed ones first then core outward, before cohesion
    // can consume the programme on peripheral street fronts. A circuit whose
    // housing lots exceed the programme by enough land to move a curtain is
    // not seeded: inside it land is dear, the walled lots are housed outward
    // from the centre without a gap (the dwelling heap below), and what the
    // households do not reach is one outer belt, which the trim releases and
    // the curtain gives back (`composition::fit_to_built`).
    if !roles::is_isolated(&pr.context.intent) {
        let mut built = vec![false; layout.blocks.len()];
        for (pi, assignment) in assignments.iter().enumerate() {
            if assignment.is_some_and(|di| !pr.demands[di].role.starts_with("open.")) {
                built[parcels[pi].block] = true;
            }
        }
        let (enclosed_lots, enclosed_land) = (0..parcels.len())
            .filter(|&pi| assignments[pi].is_none() && enclosed[pi] && dwelling.iter().any(|&di| admission[di][pi]))
            .fold((0usize, 0.0), |(n, land), pi| (n + 1, land + land_areas[pi]));
        // Land of the enclosed housing lots the programme cannot fill.
        let surplus = (enclosed_lots as f64 - fill_limit).max(0.0) * enclosed_land / enclosed_lots.max(1) as f64;
        let belt = surplus >= ENCLOSED_BELT;
        let mut candidates: Vec<usize> = (0..parcels.len())
            .filter(|&pi| assignments[pi].is_none() && !(belt && enclosed[pi]) && dwelling.iter().any(|&di| admission[di][pi]))
            .collect();
        // Enclosure and core flags of the candidates, read once for the sort.
        let mut flags = vec![(false, 0.0); parcels.len()];
        for &pi in &candidates {
            flags[pi] = (enclosed[pi], core_weight(parcels[pi].block));
        }
        candidates.sort_by(|&a, &b| {
            flags[b].0.cmp(&flags[a].0).then(flags[b].1.total_cmp(&flags[a].1)).then(prime[b].cmp(&prime[a]))
                .then(center_distances[a].total_cmp(&center_distances[b])).then(parcels[a].id.cmp(&parcels[b].id))
        });
        let mut held: f64 = dwelling.iter().map(|&di| pr.demands[di].parcel_capacity).sum();
        // Beside a circuit, the blocks are seeded from the population margin
        // only: the households of the programme go to the enclosed land first.
        let mut outside_budget = fill_limit - requested.ceil();
        for pi in candidates {
            let block = parcels[pi].block;
            if built[block] || held + 1.0 > fill_limit { continue; }
            if !flags[pi].0 && !layout.enclosures.is_empty() {
                if outside_budget < 1.0 { continue; }
                outside_budget -= 1.0;
            }
            let Some(di) = dwelling.iter().copied().find(|&di| admission[di][pi]) else { continue };
            take(pr, assignments, pi, di, 1.0);
            households[pi] = 1.0;
            built[block] = true;
            held += 1.0;
        }
    }
    let mut dwelling_order = dwelling.clone();
    dwelling_order.sort_by_key(|&di| {
        (
            pr.demands[di].function != "mixed",
            pr.demands[di].id.clone(),
        )
    });
    // `base` depends on the demand only through `commercial`: two variants.
    let mut base_cache: [Option<Vec<f64>>; 2] = [None, None];
    for &di in &dwelling_order {
        let commercial = pr.demands[di].function == "mixed";
        let goal = if commercial {
            pr.demands[di].requested * short
        } else {
            pr.demands[di].requested
        };
        let base_slot = usize::from(commercial);
        // Pure per parcel (the gate activity tests the circuits for each): in parallel.
        if base_cache[base_slot].is_none() { base_cache[base_slot] = Some(crate::urban::par::map(parcels, |pi, p| {
                // Neither the shop ranking nor the dwelling heap can take a kept lot
                // or a site already allocated in an earlier band.
                if locked[pi] || assignments[pi].is_some() { return 0.0; }
                let front = p.access.as_ref().map_or(0.0, |a| a.front_length);
                let quarter = districts.of(p).map_or(0.0, |d| {
                    if commercial && (d.role == "market" || d.role.starts_with("craft:")) {
                        1.0
                    } else {
                        0.0
                    }
                });
                // Street wall first: houses take every main-street lot before
                // any lane or back lot, so surplus land ends up behind them.
                let street = match (prime[pi], public_street(p)) {
                    (true, _) if commercial => 1.5,
                    (true, _) => PRIME_TIER,
                    (false, true) => 1.0,
                    _ => 0.0,
                };
                let core = if commercial { 0.0 } else { core_weight(p.block) };
                p.pressure * if commercial { 3.0 } else { 0.5 }
                    + front.min(30.0) * if commercial { 0.15 } else { 0.02 }
                    - center_distances[pi] / if commercial { 250.0 } else { 1500.0 }
                    + quarter
                    + street
                    + 2.0 * PRIME_TIER * core
                    + 2.4 * PRIME_TIER * crate::urban::composition::gate_activity(layout, centres[pi])
            })); }
        let base = base_cache[base_slot].as_ref().expect("base filled above");
        let mut row = admission[di].clone();
        if commercial {
            let mut ranked: Vec<usize> = (0..parcels.len())
                .filter(|&pi| {
                    assignments[pi].is_none()
                        && !retained(pi)
                        && matches!(parcels[pi].use_kind.as_str(), "plot" | "compound")
                })
                .collect();
            // Enclosed land first, then the best shop fronts.
            ranked.sort_by(|&a, &b| enclosed[b].cmp(&enclosed[a]).then(base[b].total_cmp(&base[a])).then(a.cmp(&b)));
            let wanted_plots = 3 * goal.ceil() as usize + 50;
            let mut found = 0;
            for pi in ranked {
                if found >= wanted_plots {
                    break;
                }
                let d = &pr.demands[di];
                if eligible_memo(layout, pi, &parcels[pi], d, pr, memo) {
                    row[pi] = true;
                    found += 1;
                }
            }
        }
        let mut cohesion = vec![0usize; assignments.len()];
        let mut heap = BinaryHeap::new();
        let score_key = |score: f64| {
            let bits = score.to_bits();
            if bits >> 63 == 0 {
                bits ^ (1 << 63)
            } else {
                !bits
            }
        };
        // Enclosed land is one tier above every score: inside a circuit, land
        // is housed before any lot outside it, up to the programme's need, and
        // from the centre outward: the lots left over form the outer belt.
        let rank = |pi: usize, cohesion: usize| {
            score_key(if enclosed[pi] { -center_distances[pi] } else { base[pi] + 2.0 * cohesion as f64 })
        };
        for (pi, p) in parcels.iter().enumerate() {
            if row[pi] && assignments[pi].is_none() {
                heap.push((enclosed[pi], rank(pi, 0), Reverse(p.id.as_str()), pi, 0usize));
            }
        }
        while pr.demands[di].parcel_capacity + 0.01 < goal {
            let Some((_, _, _, pi, version)) = heap.pop() else {
                break;
            };
            if assignments[pi].is_some() || cohesion[pi] != version {
                continue;
            }
            let held: f64 = dwelling.iter().map(|&di| pr.demands[di].parcel_capacity).sum();
            if held + 1.0 > fill_limit { break; }
            households[pi] = households[pi].max(1.0).min((goal - pr.demands[di].parcel_capacity).ceil().max(1.0)).min(fill_limit - held);
            take(pr, assignments, pi, di, households[pi]);
            for &j in &neighbours[pi] {
                if row[j] && assignments[j].is_none() {
                    cohesion[j] += 1;
                    heap.push((
                        enclosed[j],
                        rank(j, cohesion[j]),
                        Reverse(parcels[j].id.as_str()),
                        j,
                        cohesion[j],
                    ));
                }
            }
        }
        // Shops may overshoot their share by a few households on their last
        // plot; housing tops up its own plots, busiest first, within capacity.
        if !commercial && pr.demands[di].parcel_capacity + 0.01 < goal {
            let mut own: Vec<usize> = (0..parcels.len())
                .filter(|&pi| assignments[pi] == Some(di) && !retained(pi) && households[pi] < household_caps[pi])
                .collect();
            own.sort_by(|&a, &b| pressures[b].total_cmp(&pressures[a]).then(a.cmp(&b)));
            let rounds = own.iter().map(|&pi| (household_caps[pi] - households[pi]).max(0.0).ceil() as usize).max().unwrap_or(0);
            for _ in 0..rounds {
                if pr.demands[di].parcel_capacity + 0.01 >= goal { break; }
                let before = pr.demands[di].parcel_capacity;
                for &pi in &own {
                    if pr.demands[di].parcel_capacity + 0.01 >= goal {
                        break;
                    }
                    if households[pi] < household_caps[pi] {
                        households[pi] += 1.0;
                        pr.demands[di].parcel_capacity += 1.0;
                    }
                }
                if pr.demands[di].parcel_capacity <= before { break; }
            }
        }
        if commercial {
            continue;
        }
        // Every served lot left is a home (lanes included): no town-wide choice
        // of which lots stay gardens, so a quarter's homes depend on its own
        // lots. The number of homes is the land plan's. Only a cut far above the
        // plan meets the population cap: the excess is then shared among the
        // quarters in proportion to their lots, each leaving its own
        // lowest-ranked lots (the last the heap reaches) as gardens.
        let held: f64 = dwelling.iter().map(|&di| pr.demands[di].parcel_capacity).sum();
        let mut rest: Vec<usize> = vec![];
        let mut seen = vec![false; parcels.len()];
        while let Some((_, _, _, pi, version)) = heap.pop() {
            if assignments[pi].is_some() || cohesion[pi] != version || seen[pi] || !served(pi) {
                continue;
            }
            seen[pi] = true;
            rest.push(pi);
        }
        let room = (population_cap - held).max(0.0).floor() as usize;
        if rest.len() > room {
            let quarter_of = |pi: usize| layout.blocks.get(parcels[pi].block).map_or(usize::MAX, |b| b.quarter);
            let mut lots: BTreeMap<usize, usize> = BTreeMap::new();
            for &pi in &rest { *lots.entry(quarter_of(pi)).or_default() += 1; }
            let excess = rest.len() - room;
            let share = |n: usize| excess as f64 * n as f64 / rest.len() as f64;
            let mut drop: BTreeMap<usize, usize> = lots.iter().map(|(&q, &n)| (q, share(n).floor() as usize)).collect();
            let mut left = excess.saturating_sub(drop.values().sum::<usize>());
            let mut order: Vec<(usize, f64)> = lots.iter().map(|(&q, &n)| (q, share(n) - share(n).floor())).collect();
            order.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            for (q, _) in order {
                if left == 0 { break; }
                if let Some(n) = drop.get_mut(&q) { *n += 1; left -= 1; }
            }
            // Each quarter drops from its own end of the ranking.
            let mut kept = vec![true; rest.len()];
            for (k, &pi) in rest.iter().enumerate().rev() {
                if let Some(n) = drop.get_mut(&quarter_of(pi)) && *n > 0 {
                    *n -= 1;
                    kept[k] = false;
                }
            }
            rest = rest.into_iter().zip(kept).filter(|(_, k)| *k).map(|(pi, _)| pi).collect();
        }
        let extra = rest.len();
        for pi in rest {
            take(pr, assignments, pi, di, 1.0);
            extra_households[pi] = true;
        }
        if extra > 0 {
            pr.demands[di].reasons.push(format!(
                "{extra} maison(s) ajoutée(s) pour remplir les îlots desservis (plafond de population : +30 %)"
            ));
        }
    }
    Housing { households, tower_households, extra_households }
}

pub(super) fn scatter_households(
    sites: &Sites<'_>,
    retained_lots: &RetainedLots<'_>,
    pr: &mut UrbanProgramme,
    admission: &[Vec<bool>],
    assignments: &mut [Option<usize>],
    early: &EarlyAssignments,
    households: &mut [f64],
) {
    let Sites { part, enclosed, center_distances, .. } = sites;
    let parcels = &part.parcels;
    let EarlyAssignments { locked, dwelling, .. } = early;
    let retained = |pi: usize| retained_lots.retains(&parcels[pi]);
    // A multi-household home can seed an empty frontage without adding people.
    let mut scattered = 0;
    let mut donors: BTreeMap<usize,BinaryHeap<(u64,Reverse<usize>)>> = BTreeMap::new();
    for j in 0..parcels.len() {
        if !locked[j] && households[j] >= 2.0 && let Some(di) = assignments[j]
            && pr.demands[di].unit == "domesticUnits" {
            donors.entry(di).or_default().push((households[j] as u64,Reverse(j)));
        }
    }
    // Enclosed frontages first, from the centre outward, then the open street fronts.
    let mut vacant: Vec<usize> = (0..parcels.len()).collect();
    vacant.sort_by(|&a, &b| enclosed[b].cmp(&enclosed[a])
        .then(if enclosed[a] && enclosed[b] { center_distances[a].total_cmp(&center_distances[b]) } else { std::cmp::Ordering::Equal }));
    for pi in vacant {
        if assignments[pi].is_some() || retained(pi) || !public_street(&parcels[pi]) && !enclosed[pi] { continue; }
        let Some(di) = dwelling.iter().copied().filter(|&di|admission[di][pi] && donors.get(&di).is_some_and(|h|!h.is_empty()))
            .max_by_key(|di|donors[di].peek().copied()) else { continue };
        let (_,Reverse(j)) = donors.get_mut(&di).unwrap().pop().unwrap();
        households[j] -= 1.0;
        if households[j] >= 2.0 { donors.get_mut(&di).unwrap().push((households[j] as u64,Reverse(j))); }
        pr.demands[di].parcel_capacity -= 1.0;
        households[pi] = 1.0;
        take(pr, assignments, pi, di, 1.0);
        scattered += 1;
    }
    if scattered > 0 { pr.warnings.push(warnings::households_scattered(scattered)); }
}

/// Heap tier of a main-street lot for housing: above any cohesion bonus.
const PRIME_TIER: f64 = 100.0;
/// Land (m²) of the housing lots inside the circuits beyond what the
/// programme may house (+30 %), from which that surplus is an outer belt the
/// curtain gives back rather than empty lots spread over every block: the
/// smallest empty piece that moves a curtain (`composition::fit_to_built`).
const ENCLOSED_BELT: f64 = 10_000.0;
/// Public frontage on a main street (rank 0 or 1): the street wall.
/// Main-street lots, and the faubourg lean-tos at the gates: built first
/// (shops ahead of houses) and never left as empty gardens while a house fits.
pub(super) fn prime_frontage(p: &Parcel) -> bool {
    public_street(p) && (p.rank <= 1 || p.family == "faubourg")
}
fn public_street(p: &Parcel) -> bool {
    matches!(p.use_kind.as_str(), "plot" | "compound")
        && p.access.as_ref().is_some_and(|a| a.kind == "public")
}
/// Households per plot. Every free plot fit for housing holds one; the rest
/// of the wanted households fill the spare capacity of the busiest plots
/// first (weight grows with road pressure), so the core rises in tenements
/// and the edge stays one house per lot. The total equals `wanted` exactly
/// when the land allows it: the share is continuous in the fill factor and
/// rounded by largest remainders, with no rounding cliff. With more plots
/// than households every plot holds one and the allocation order decides
/// which ones become gardens. Plots already taken hold at most one.
pub(super) fn spread_households(caps: &[f64], pressure: &[f64], free: &[bool], wanted: f64, land: Option<&[f64]>) -> Vec<f64> {
    let open: Vec<usize> = (0..caps.len())
        .filter(|&i| free[i] && caps[i] > 0.0)
        .collect();
    let mut out: Vec<f64> = caps
        .iter()
        .zip(free)
        .map(|(&c, &f)| {
            if c <= 0.0 {
                0.0
            } else if f {
                1.0
            } else {
                c.min(1.0)
            }
        })
        .collect();
    let extra = (wanted.round() - open.len() as f64).max(0.0);
    let spare = |i: usize| (caps[i] - 1.0).max(0.0);
    // Squared so the busy core clearly outgrows the quiet edge. With
    // `zoneDensity: gradient` the extra households follow the lot's land and
    // its pressure (households per hectare along the access gradient), not
    // the zone's capacity step; the capacity still bounds each lot.
    // Fourth power there, so the centre stays clearly the densest.
    let weight = |i: usize| match land {
        Some(a) => a[i] / 100.0 * (0.15 + pressure[i].clamp(0.0, 1.0)).powi(4),
        None => spare(i) * (0.15 + pressure[i].clamp(0.0, 1.0)).powi(2),
    };
    let total: f64 = open.iter().map(|&i| spare(i)).sum();
    if extra <= 0.0 {
        return out;
    }
    if extra >= total {
        for &i in &open {
            out[i] = caps[i];
        }
        return out;
    }
    let share = |i: usize, f: f64| spare(i).min(weight(i) * f);
    // Land weights are small numbers: their fill factor needs a wider bracket.
    let (mut lo, mut hi) = (0.0, if land.is_some() { 1.0e4 } else { 50.0 });
    for _ in 0..60 {
        let mid = 0.5 * (lo + hi);
        if open.iter().map(|&i| share(i, mid)).sum::<f64>() < extra {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let mut rest = extra;
    let mut remainders = Vec::with_capacity(open.len());
    for &i in &open {
        let x = share(i, hi);
        let whole = x.floor();
        out[i] += whole;
        rest -= whole;
        if whole < spare(i) {
            remainders.push((x - whole, i));
        }
    }
    remainders.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    for &(_, i) in remainders.iter().take(rest.round().max(0.0) as usize) {
        out[i] += 1.0;
    }
    out
}
/// Whether a village plot is a farmstead. Not every village household farms
/// its own land with a barn (artisans, labourers, the priest): farms are the
/// majority of a hamlet, fewer in a village, and fewer still near its centre,
/// so large farm buildings stay a minority of the village's buildings.

/// Dwelling typologies built for several households (apartments, tenements,
/// slabs): their plots keep the floor-area capacity in villages
/// and small towns, as longhouses do.
pub(super) const COLLECTIVE_TYPOLOGIES: &[&str] = &[
    "apartment-block", "apartment-building", "apartment-palace", "apartment-slab", "chawl",
    "green-block", "grown-tower", "housing-slab", "megatower", "mixed-use-block", "panel-block",
    "perimeter-block", "pilotis-slab", "self-built-block", "setback-block", "stalinka",
    "stone-apartment", "tenement", "tenement-row", "terrace-block",
    "terraced-green-block", "timber-block", "tower-block", "worker-block",
];
/// Households a plot can hold. A village home holds one household; a town
/// house one, or two to three when it is a large house (from 2,000 to 4,000
/// people, `roles::town_house_share`); the culture's floor-area tenement cap
/// (useful floor over the floor per household, scaled by district wealth) only
/// near the centre of a city (lot access `pressure`, `roles::dense_core_share`).
/// Longhouses and collective typologies keep the floor-area capacity everywhere.
#[allow(clippy::too_many_arguments)]
pub(super) fn household_capacity(
    a: f64,
    coverage: f64,
    floors: f64,
    occupancy: &roles::Occupancy,
    wealth: f64,
    village: bool,
    population: u32,
    communal: bool,
    pressure: f64,
) -> f64 {
    if village {
        return 1.0;
    }
    let per = occupancy.floor_per_household * (0.7 + 0.8 * wealth.clamp(0.0, 1.0));
    let urban = (a * coverage * floors / per)
        .floor()
        .clamp(1.0, occupancy.max_per_plot.max(1.0));
    // A longhouse or a declared collective typology (apartment building,
    // tenement, slab) is built for several households at any size.
    if communal { return urban; }
    // Only a large indicative house, not a generous yard alone, gets several
    // households, and only in a town.
    let large_house = 1. + ((a * coverage * floors / 160.).floor().clamp(1., 3.) - 1.) * roles::town_house_share(population);
    // Tenements fill a city's dense core, reached progressively toward its centre.
    let t = ((pressure - 0.45) / 0.45).clamp(0., 1.);
    let dense = roles::dense_core_share(population) * t * t * (3. - 2. * t);
    urban.min((large_house + (urban - large_house).max(0.) * dense).floor().max(1.))
}
/// Default population limit for a communal house with no declared dimensions.
const LONGHOUSE_PERSONS: f64 = 20.0;

/// Most households under one communal roof (longhouse, maloca, plank house). A culture
/// that declares its house (`campHouse`, a visibly large building: a 60 m Iroquoian
/// longhouse, a maloca) holds what that floor gives at the culture's floor per household;
/// any other longhouse holds `LONGHOUSE_PERSONS` at the culture's household size (Norse:
/// two households of eight). A declared `campHouseholds` replaces both (`allocate`).
fn roof_households(house: f64, occupancy: &roles::Occupancy) -> f64 {
    if house > 0.0 {
        (house / occupancy.floor_per_household.max(1.0)).floor().max(1.0)
    } else {
        (LONGHOUSE_PERSONS / occupancy.household_size.max(1.0)).floor().max(1.0)
    }
}
