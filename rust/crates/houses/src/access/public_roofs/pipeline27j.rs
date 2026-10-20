//! Pure ordered routing; no observer, captures, timings or external state.
use super::*;
pub(super) fn add_routes(unit: &mut HouseUnit) -> Result<(), String> {
    let needed = collective_targets(unit);
    let mut targets: Vec<_> = unit
        .access
        .nodes
        .iter()
        .filter(|n| needed.contains(&n.id))
        .cloned()
        .collect();
    targets.sort_by(|a, b| a.z_m.total_cmp(&b.z_m).then(a.id.cmp(&b.id)));
    for target in targets {
        let public = public_reachable(unit);
        if public.contains(&target.id) {
            continue;
        }
        let mut bases: Vec<_> = unit
            .access
            .nodes
            .iter()
            .filter(|n| public.contains(&n.id) && n.z_m < target.z_m - CONTACT)
            .cloned()
            .collect();
        bases.sort_by(|a, b| b.z_m.total_cmp(&a.z_m).then(a.id.cmp(&b.id)));
        let mut accepted = None;
        for (events, reduced) in [(false, false), (true, false), (false, true), (true, true)] {
            if let Some(candidate) = legacy27j::search(unit, &bases, &target, events, reduced)? {
                accepted = Some(candidate);
                break;
            }
        }
        if let Some(candidate) = accepted {
            *unit = candidate;
            continue;
        }
        if links::add_route(unit, &bases, &target)? {
            continue;
        }
        if outboard::add_route(unit, &bases, &target)? {
            continue;
        }
        if let Some(candidate) = super::search(unit, &bases, &target, true) {
            *unit = candidate;
            continue;
        }
        if outboard::add_eaves_route(unit, &bases, &target)? {
            continue;
        }
        if outboard::add_roof_event_route(unit, &bases, &target)? {
            continue;
        }
        if super::twoflight_add_route(unit, &bases, &target)? {
            continue;
        }
        if twoflight::add_grid_route(unit, &bases, &target)? {
            continue;
        }
        if twoflight::add_viga_route(unit, &bases, &target)? {
            continue;
        }
        return Err(format!(
            "{} : no existing candidate accepted in the real native order",
            target.id
        ));
    }
    validate(unit, false)
}
