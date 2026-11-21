//! Whole-block reservation, including footing, access and the budget for enclosed open ground.

use crate::urban::{Layout, ParcelContact, Point, Shape, Surface, geometry::{area, centroid},
    roles::{self, Frame}, warnings};
use std::collections::BTreeSet;

use super::{BlockEnvironment, Demand, ProgrammeContext, Reservation, camps, dist,
    demand::capacity, environment::{block_culture, function_class, profile_pack}};

/// Share of the town plan's block area (inside the wall; without a wall, the
/// core and middle zones) that may be open ground: the squares the plan drew
/// plus the housing blocks reservations turn into markets, commons, parks or
/// cemeteries.
const PLAN_OPEN: f64 = 0.03;

/// Inscribed radius of a block outline (`deep_blocks`): a pure function of the
/// outline, kept across the programme probes of one quarters run.
static RADII: crate::urban::probe_cache::Memo<f64> = crate::urban::probe_cache::Memo::new();
pub(in crate::urban) fn clear_probe_cache() {
    RADII.clear();
}
fn block_radius(shape: &Shape) -> f64 {
    let mut key = crate::urban::probe_cache::Key::new("programme.inscribed_radius/v1");
    key.shape(shape);
    if let Some(r) = RADII.get(&key) {
        return r;
    }
    let r = crate::urban::deep_blocks::inscribed_radius(shape);
    RADII.put(key, r);
    r
}

#[allow(clippy::too_many_arguments)]
pub(super) fn reserve_blocks(
    layout: &mut Layout,
    population: u32,
    context: &ProgrammeContext,
    surface: Surface<'_>,
    environment: &[BlockEnvironment],
    block_contacts: &[Vec<ParcelContact>],
    demands: &mut [Demand],
    warnings: &mut Vec<String>,
    isolated: bool,
    navigable: bool,
) -> Vec<Reservation> {
    let district_roles: Vec<String> = layout.structure.as_ref().map_or_else(Vec::new, |s| {
        s.districts.iter().map(|d| d.role.clone()).collect()
    });
    let frame = Frame::new(layout, environment);
    let mut reservations = vec![];
    let mut used = BTreeSet::new();
    let mut reservation_order = demands
        .iter()
        .enumerate()
        .filter(|(_, d)| {
            isolated
                || d.placement == "block"
                || (d.sites == 0
                    && matches!(
                        d.function.as_str(),
                        "market" | "collective" | "warehouse" | "common"
                    ))
                || (d.function == "workshop"
                    && d.requires.iter().any(|r| r.starts_with("knownResource:")))
        })
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    // Existing markets and constrained built functions retain first choice;
    // open commons then use remaining public land, never private rear gardens.
    reservation_order.sort_by_key(|&i| {
        (
            match demands[i].function.as_str() {
                "market" => 0,
                "warehouse" => 1,
                "collective" => 2,
                "workshop" => 3,
                "common" => 4,
                _ => 5,
            },
            !demands[i].landmark,
        )
    });
    // Block module, admission and contact envelope are pure per (block,
    // function class): memoised once, shared by the per-block parallel scan.
    use std::sync::OnceLock;
    let class_index = |c: &str| match c {
        "domestic" => 0,
        "mixed" => 1,
        _ => 2,
    };
    let modules: Vec<OnceLock<Option<f64>>> =
        layout.blocks.iter().map(|_| OnceLock::new()).collect();
    type Admission = OnceLock<Option<crate::urban::UrbanAdmissibility>>;
    let admissions: Vec<[Admission; 3]> = layout
        .blocks
        .iter()
        .map(|_| std::array::from_fn(|_| OnceLock::new()))
        .collect();
    let envelopes: Vec<[OnceLock<bool>; 3]> = layout
        .blocks
        .iter()
        .map(|_| std::array::from_fn(|_| OnceLock::new()))
        .collect();
    let foundable: Vec<[OnceLock<bool>; 3]> = layout
        .blocks
        .iter()
        .map(|_| std::array::from_fn(|_| OnceLock::new()))
        .collect();
    let radii: Vec<OnceLock<f64>> = layout.blocks.iter().map(|_| OnceLock::new()).collect();
    type Frontage = OnceLock<Option<(usize, f64, bool)>>;
    let frontages: Vec<[Frontage; 2]> = layout
        .blocks
        .iter()
        .map(|_| std::array::from_fn(|_| OnceLock::new()))
        .collect();
    let centroids: Vec<Point> = crate::urban::par::map(&layout.blocks, |_, b| centroid(&b.shape));
    let areas: Vec<f64> = crate::urban::par::map(&layout.blocks, |_, b| area(&b.shape));
    // The town plan is built land: inside the wall, or without a wall in the
    // core and middle zones, the open ground (the squares the plan drew, and
    // the housing blocks turned into a market, a common, a park or a cemetery)
    // totals at most `PLAN_OPEN` of the plan's block area. Past it a common,
    // a park or a cemetery lies outside the plan, or takes a parcel. Nucleus
    // figures (a plaza, a kraal) are the town's own form.
    let rings: Vec<crate::urban::geometry::ContainmentIndex> = layout
        .enclosures
        .iter()
        .map(|e| crate::urban::geometry::ContainmentIndex::new(&Shape { outer: e.path.clone(), holes: vec![] }))
        .collect();
    let mut enclosed: Vec<bool> = if isolated {
        vec![false; layout.blocks.len()]
    } else if rings.is_empty() {
        layout.blocks.iter().map(|b| matches!(b.zone.as_str(), "core" | "middle")).collect()
    } else {
        crate::urban::par::map(&layout.blocks, |_, b| {
            let at = crate::urban::geometry::interior_point(&b.shape);
            rings.iter().any(|r| r.contains(at))
        })
    };
    // A place that is all plan (a hamlet, a wall without a suburb) has no
    // outside to send them to: its commons stay among its houses.
    if !enclosed.iter().zip(&layout.blocks).any(|(e, b)| !*e && b.kind == "block") {
        enclosed.fill(false);
    }
    let open_budget = PLAN_OPEN * enclosed.iter().zip(&areas).filter(|(e, _)| **e).map(|(_, a)| a).sum::<f64>();
    let mut open_taken: f64 = layout.blocks.iter().enumerate()
        .filter(|(bi, b)| enclosed[*bi] && matches!(b.kind.as_str(), "place" | "market" | "common" | "reserve:market" | "reserve:common"))
        .map(|(bi, _)| areas[bi])
        .sum();
    // The culture of each block, as a slot in the list of distinct cultures:
    // facts that depend on the culture alone are resolved once per culture.
    let (block_cultures, culture_slot): (Vec<String>, Vec<usize>) = {
        let mut names: Vec<String> = vec![];
        let slots = (0..layout.blocks.len())
            .map(|bi| {
                let culture = block_culture(layout, bi);
                names.iter().position(|n| n == culture).unwrap_or_else(|| {
                    names.push(culture.to_owned());
                    names.len() - 1
                })
            })
            .collect();
        (names, slots)
    };
    // Whether the town is a camp does not change while blocks are reserved.
    let camp = camps::camp(layout, population);
    let functional_mode = match context.mode.as_str() {
        "strict" => "historical_strict",
        "fantasy" => "fantasy_mix",
        _ => "historical_inspired",
    };
    for di in reservation_order {
        let d = &mut demands[di];
        if d.requires.iter().any(|r| r == "navigableAccess") && !navigable {
            d.reasons
                .push("No measured navigable quay frontage; a declaration or water proximity is insufficient".into());
            continue;
        }
        let needs_water = d
            .requires
            .iter()
            .any(|r| r == "navigableAccess" || r == "waterfront");
        let class = function_class(&d.function);
        // A missing functional source is not an unsuccessful domestic footing.
        // Query the same versioned coverage decision as site production before
        // reserving land through a residential admission profile. Other roles
        // retain the cached envelope/foundation path and its performance.
        // Both facts below depend on the block's culture alone (its pack is the
        // culture's), so each is resolved once per distinct culture.
        let missing_source:Vec<bool> = if !isolated && crate::urban::culture::requires_functional_source(&d.role,&d.function) {
            let gaps: Vec<bool> = block_cultures.iter().map(|culture|
                crate::urban::culture::functional_source_gap(culture,
                    crate::urban::culture::architecture_pack(culture).unwrap_or_default(),&d.role,&d.function,&context.period,functional_mode).is_some()
            ).collect();
            culture_slot.iter().map(|&slot| gaps[slot]).collect()
        } else { Vec::new() };
        let functional_profiles: Vec<Option<crate::urban::culture::CultureMapping>> = block_cultures.iter().map(|culture|
            crate::urban::culture::functional_mapping(culture,&d.role,&d.function,&context.period,functional_mode)).collect();
        let source_missing_count=missing_source.iter().filter(|&&missing|missing).count();
        if source_missing_count>0 {
            d.reasons.push(format!("source_absente: Functional architectural source coverage missing in {source_missing_count} block context(s); no residential recipe certifies or excludes this facility's footing"));
        }
        if !missing_source.is_empty() && source_missing_count==missing_source.len() { continue; }
        let (layout_ref, used_ref, demand) = (&*layout, &used, &*d);
        let mut options = crate::urban::par::map(&layout_ref.blocks, |bi, b| {
            let (layout, used, d) = (layout_ref, used_ref, demand);
            if camp && !camps::supported(layout, population, bi, d, context) { return None; }
            if missing_source.get(bi)==Some(&true) { return None; }
            if needs_water && !environment[bi].waterfront {
                return None;
            }
            let existing_open = match d.function.as_str() {
                "market" => matches!(b.kind.as_str(), "place" | "market" | "reserve:market"),
                "common" => matches!(b.kind.as_str(), "place" | "common" | "reserve:common"),
                _ => false,
            };
            if (!existing_open && b.kind != "block") || used.contains(&bi) || environment[bi].wet {
                return None;
            }
            let isolated_profile;
            let functional_profile=&functional_profiles[culture_slot[bi]];
            let profile = if isolated {
                isolated_profile = crate::urban::culture::isolated_mapping(
                    block_culture(layout, bi),
                    &context.period,
                    &context.intent,
                )?
                .admissibility;
                &isolated_profile
            } else if let Some(functional) = functional_profile { &functional.admissibility } else {
                admissions[bi][class_index(class)]
                    .get_or_init(|| {
                        crate::urban::culture::block_mapping(
                            layout,
                            block_culture(layout, bi),
                            bi,
                            &d.function,
                            &context.period,
                        )
                        .map(|c| c.admissibility)
                    })
                    .as_ref()?
            };
            // An activity site stands where its resource is (a hill for a windmill): no house slope limit.
            if context.intent != "activity" && environment[bi].slope > crate::urban::profiles::house_slope(block_culture(layout, bi), profile.max_slope, context.slope_relax) {
                return None;
            }
            // The longest contact, its street and the continuous frontage are
            // the block's own, for the contacts a common may use or for all.
            let (street, front, shared_door) = (*frontages[bi][(d.function == "common") as usize].get_or_init(|| {
                let filtered;
                let public_contacts: &[_] = if d.function == "common" {
                    filtered = block_contacts[bi]
                        .iter()
                        .filter(|c| matches!(c.kind.as_str(), "public" | "collective"))
                        .cloned()
                        .collect::<Vec<_>>();
                    &filtered
                } else {
                    &block_contacts[bi]
                };
                let contact = public_contacts.iter().max_by(|a, b| {
                    a.length
                        .total_cmp(&b.length)
                        .then_with(|| b.street.cmp(&a.street))
                })?;
                Some((
                    contact.street,
                    crate::urban::parcels::continuous_frontage(public_contacts),
                    matches!(contact.kind.as_str(), "private" | "collective"),
                ))
            }))?;
            let a = areas[bi];
            let minimum = if d.function == "common" || shared_door {
                profile.min_access_width
            } else {
                d.target_frontage
            };
            if front < minimum {
                return None;
            }
            let activity = context.intent == "activity" && d.role == "craft.activity";
            if activity && crate::urban::activities::retained_yard(layout, &context.template, bi, &b.shape, &surface).is_empty() {
                return None;
            }
            let envelope = || {
                crate::urban::parcels::contact_envelope(
                    &b.shape,
                    &block_contacts[bi],
                    profile.min_frontage,
                    profile.min_depth,
                    profile.min_access_width,
                )
                .is_some()
            };
            // A shrine or farm yard need not hold the culture's residential
            // courtyard/compound. Its actual bodies above are the witness.
            if !activity && (isolated || matches!(d.function.as_str(), "warehouse" | "collective" | "workshop"))
                && !if isolated {
                    envelope()
                } else {
                    *envelopes[bi][class_index(class)].get_or_init(envelope)
                }
            {
                return None;
            }
            // A facility pins its block's native admission recipe: the block
            // must found it (houses' foundation step at a pose along one of its
            // streets), else the reservation only yields a refused building
            // and keeps the block from the tissue. Roles houses resolves from
            // its own functional registry pin nothing and are not tested here.
            if !isolated
                && crate::urban::building_sites::round7()
                && matches!(d.function.as_str(), "warehouse" | "collective" | "workshop")
                && !crate::urban::culture::functional_role_resolved(
                    block_culture(layout, bi),
                    &profile_pack(layout, bi, &d.function, &context.period),
                    &d.role,
                    &d.function,
                )
                && !*foundable[bi][class_index(class)].get_or_init(|| {
                    let dirs: Vec<Point> = block_contacts[bi]
                        .iter()
                        .filter(|c| c.length > 1.0)
                        .map(|c| Point {
                            x: (c.b.x - c.a.x) / c.length.max(1e-9),
                            y: (c.b.y - c.a.y) / c.length.max(1e-9),
                        })
                        .collect();
                    crate::urban::building_sites::recipe_foundable(
                        surface,
                        &b.shape,
                        &dirs,
                        &profile.recipe_id,
                    )
                })
            {
                return None;
            }
            // One facility follows the tissue's existing block module;
            // total metropolitan demand is served by several real sites.
            let module = modules[bi]
                .get_or_init(|| {
                    crate::urban::culture::block_morph(layout, block_culture(layout, bi), bi).map(
                        |(zone, m)| {
                            let r = m.block_size(zone);
                            (r[0] + r[1]) * 0.5
                        },
                    )
                })
                .unwrap_or(profile.min_area)
                .max(profile.min_area);
            let target = if isolated {
                d.target_area.max(profile.min_area)
            } else {
                module.min(d.target_area.max(profile.min_area))
            };
            // Do not consume an oversized housing block for a tiny market
            // or workshop. Existing places and explicit isolated estates
            // retain their real geometry independently of this heuristic.
            if !isolated && !existing_open && a > target * 4.0 {
                return None;
            }
            // A built facility stands whole on land it uses; the rest of a
            // reserved block stays bare among the houses. A crescent or a strip
            // (inscribed square under 30 % of the block) holds houses along its
            // street, not a compound. An ordinary facility takes neither twice
            // its land nor under half of it (a shrunken building): it then falls
            // to a plot of the tissue. Only a landmark holds a larger precinct.
            if !isolated && matches!(d.function.as_str(), "warehouse" | "collective" | "workshop") {
                let radius = *radii[bi].get_or_init(|| block_radius(&b.shape));
                if 4.0 * radius * radius < 0.3 * a || (!d.landmark && (a > 2.0 * target || a < 0.5 * target)) {
                    return None;
                }
            }
            // A small common or cemetery takes a parcel, not a whole ward. A
            // remnant block under half the tissue's module is no ward: it may
            // hold a common up to two and a half times its size.
            let slack = if d.role == "open.common" && a < module * 0.5 { 2.5 } else { 1.5 };
            if !isolated && !existing_open && !layout.enclosures.is_empty()
                && d.function == "common" && a > d.target_area.max(30.0) * slack {
                return None;
            }
            if !existing_open && enclosed[bi] && d.function == "common" && d.site != "nucleus"
                && open_taken + a > open_budget {
                return None;
            }
            let c = centroids[bi];
            let score = if d.sites > 0 {
                let facts = frame.facts(c, environment.get(bi));
                // A harbour's port roles stand only on quay-served blocks.
                if !roles::site_admissible(&d.site, &facts) {
                    return None;
                }
                let district = environment[bi]
                    .district
                    .and_then(|i| district_roles.get(i))
                    .is_some_and(|r| !d.district.is_empty() && r.starts_with(&d.district));
                (if existing_open { -3.0 } else { 0.0 })
                    + (a / target).ln().abs() * 0.7
                    + roles::site_cost(&d.site, &facts)
                    - if district { 1.0 } else { 0.0 }
            } else {
                (if existing_open { -1_000_000.0 } else { 0.0 })
                    + (a / target).ln().abs()
                    + dist(c, layout.center) / 1000.0
            };
            Some((
                bi,
                street,
                front,
                score + crate::urban::fortification::service_cost(layout, d, c)
                    + (d.target_frontage - front).max(0.0) / d.target_frontage.max(1.0),
            ))
        })
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        options.sort_by(|a, b| a.3.total_cmp(&b.3).then(a.0.cmp(&b.0)));
        // Site demands pick distinct, spread blocks; legacy demands fill area.
        let picks: Vec<(usize, usize, f64)> = if d.sites > 0 {
            let spacing = frame.radius * 1.6 / (d.sites as f64).sqrt();
            // Crowding of each option by the sites already chosen, summed in
            // choice order as they are picked (one pass per pick, not per
            // option and pick). Started from an empty `sum` (-0.0), as the
            // former per-option sum, so the scores stay bit-identical.
            let mut crowd = vec![std::iter::empty::<f64>().sum::<f64>(); options.len()];
            let mut taken = vec![false; options.len()];
            let mut chosen: Vec<(usize, usize, f64)> = vec![];
            for _ in 0..d.sites.min(options.len()) {
                let best = options
                    .iter()
                    .enumerate()
                    .filter(|(k, _)| !taken[*k])
                    .map(|(k, o)| (k, o, o.3 + 3.0 * crowd[k]))
                    .min_by(|a, b| a.2.total_cmp(&b.2).then(a.1.0.cmp(&b.1.0)));
                let Some((k, o, _)) = best else { break };
                taken[k] = true;
                chosen.push((o.0, o.1, o.2));
                let c = centroids[o.0];
                for (j, q) in options.iter().enumerate() {
                    crowd[j] += (1.0 - dist(centroids[q.0], c) / spacing).max(0.0);
                }
            }
            chosen
        } else {
            let mut reserved_capacity = 0.0;
            let mut out = vec![];
            for &(bi, street, front, _) in &options {
                if !out.is_empty() && (isolated || reserved_capacity + 0.01 >= d.requested) {
                    break;
                }
                reserved_capacity += capacity(areas[bi], d);
                out.push((bi, street, front));
            }
            out
        };
        // Several sites of one demand share the plan's open budget.
        let picks: Vec<(usize, usize, f64)> = picks
            .into_iter()
            .filter(|&(bi, _, _)| {
                let converted = enclosed[bi] && layout.blocks[bi].kind == "block"
                    && matches!(d.function.as_str(), "market" | "common");
                if converted && d.function == "common" && d.site != "nucleus" && open_taken + areas[bi] > open_budget {
                    return false;
                }
                if converted {
                    open_taken += areas[bi];
                }
                true
            })
            .collect();
        let mut reserved_capacity = 0.0;
        for &(bi, street, front) in &picks {
            if context.intent == "activity" {
                let yard = crate::urban::activities::retained_yard(layout, &context.template, bi, &layout.blocks[bi].shape, &surface);
                let step = crate::urban::activities::yard_step(&yard, &surface);
                if step > 0.75 {
                    warnings.push(warnings::stepped_activity(step));
                }
            }
            used.insert(bi);
            if layout.blocks[bi].kind == "block" {
                layout.blocks[bi].kind = "reserve:programme".into();
            }
            reservations.push(Reservation {
                id: format!("{}/reserve/{}/{}", layout.key, d.function, bi),
                demand_id: d.id.clone(),
                block: bi,
                shape: layout.blocks[bi].shape.clone(),
                street,
                frontage: front,
            });
            reserved_capacity += capacity(areas[bi], d);
        }
        if picks.is_empty() {
            d.reasons.push(
                "No suitably sized accessible block for reservation before subdivision".into(),
            );
        }
        // Degenerate case only: a lone farm or structure whose plot no gate admits (a plot
        // clipped by its track or a bank, a short frontage) still reserves its own largest
        // dry block, so the place keeps its building (`eligible_memo` admits it there).
        let fallback: Vec<(usize, usize, f64)> = if picks.is_empty() && isolated && context.intent != "activity" {
            (0..layout.blocks.len())
                .filter(|&bi| !used.contains(&bi) && layout.blocks[bi].kind == "block" && environment.get(bi).is_none_or(|e| !e.wet))
                .max_by(|&a, &b| areas[a].total_cmp(&areas[b]).then(b.cmp(&a)))
                .map(|bi| {
                    let street = block_contacts[bi].iter().max_by(|a, b| a.length.total_cmp(&b.length)).map_or(0, |c| c.street);
                    vec![(bi, street, crate::urban::parcels::continuous_frontage(&block_contacts[bi]))]
                })
                .unwrap_or_default()
        } else {
            vec![]
        };
        if !fallback.is_empty() && d.reasons.last().is_some_and(|r| r.starts_with("No suitably sized")) {
            d.reasons.pop();
            warnings.push(warnings::isolated_farm_reserve());
        }
        for &(bi, street, front) in &fallback {
            used.insert(bi);
            if layout.blocks[bi].kind == "block" {
                layout.blocks[bi].kind = "reserve:programme".into();
            }
            reservations.push(Reservation {
                id: format!("{}/reserve/{}/{}", layout.key, d.function, bi),
                demand_id: d.id.clone(),
                block: bi,
                shape: layout.blocks[bi].shape.clone(),
                street,
                frontage: front,
            });
        }
        if picks.is_empty() {
        } else if d.sites > 0 && picks.len() < d.sites {
            d.reasons.push(format!(
                "Only {} of {} sites reserved before subdivision",
                picks.len(),
                d.sites
            ));
        } else if !isolated && d.sites == 0 && reserved_capacity + 0.01 < d.requested {
            d.reasons.push("Accessible reserved sites do not cover the indicative land capacity; built capacity remains unverified".into());
        }
    }
    reservations
}
