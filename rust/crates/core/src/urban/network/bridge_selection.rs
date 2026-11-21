//! Choose crossings that connect built banks and meet the town's crossing budget.

use super::analysis::Graph;
use super::banks::regional_banks;
use super::bridge_construction::built_bank_crossings;
use super::policy;
use super::reservations::remap_reservations;
use super::spatial::{BoxGrid, EPS, distance, key, lerp};
use super::street::width;
use super::water_clearance::clear_bank_ends;
use crate::urban::{Layout, Point, Street, Surface, profile::Lap};
use std::collections::{BTreeMap, BTreeSet};

/// Village scale for the bridge budget: the crossing demand is one, whatever the frontage.
pub(in crate::urban) fn village_crossings(population: u32) -> bool {
    crate::urban::footprint::crossings::street_count(population, f64::INFINITY) == 1
}

#[cfg(test)]
pub(in crate::urban) fn select_bridges(layout: &mut Layout, population: u32, surface: Surface<'_>, roads: &[Street]) {
    select_bridges_graded(layout, population, surface, roads, 0.12);
}

/// Preserve connections between built parts, then fill a stable size/frontage
/// demand with through routes first and well-separated secondary crossings.
pub(in crate::urban) fn select_bridges_graded(layout: &mut Layout, population: u32, surface: Surface<'_>, roads: &[Street], max_grade: f64) {
    let _profile = crate::urban::routing::Profile::new("bridge_select");
    if surface.geometry.is_none() && !surface.water.iter().any(|&w| w != 0) { return; }
    let reserved: Vec<_> = layout.programme.iter().flat_map(|p| &p.reservations)
        .map(|r| layout.streets.get(r.street).cloned()).collect();
    let mut laps = Lap::new("bridge_select");
    select_bridges_inner(layout, population, surface, roads, true, max_grade, roads);
    laps.lap("select");
    let cfg = layout.config.clone().unwrap_or_default();
    if cfg.harbour_bridge_clearance { policy::harbour_clearance(layout, surface, population, max_grade); }
    laps.lap("harbour_clearance");
    if cfg.river_spur_filter { policy::river_spurs(layout, surface); }
    laps.lap("river_spurs");
    clear_bank_ends(&mut layout.streets, surface);
    laps.lap("clear_bank_ends");
    remap_reservations(layout, &reserved);
    laps.lap("remap");
}

fn select_bridges_inner(layout: &mut Layout, population: u32, surface: Surface<'_>, roads: &[Street], supply: bool, max_grade: f64, network: &[Street]) {
    use crate::urban::{footprint::crossings, geometry as g, routing};
    let mut laps = Lap::new("bridge_select");
    let streets = &mut layout.streets;
    let land: Vec<_> = streets.iter().filter(|s| s.role != "bridge").cloned().collect();
    let spans: Vec<_> = streets.iter().filter(|s| s.role == "bridge").cloned().collect();
    let banks = Graph::new(&land);
    let bridges = Graph::new(&spans);
    let blocks: Vec<_> = layout.blocks.iter().filter(|b| b.kind == "block")
        .map(|b| (g::bbox(&b.shape), &b.shape)).collect();
    let mut served = vec![false; banks.length.len()];
    let mut frontage = vec![0.0; served.len()];
    // Whether `p` is inside a block or within `reach` of its outline: only the
    // blocks whose box lies within `reach` of `p` are tested.
    let block_grid = BoxGrid::new(&blocks.iter().map(|b| b.0).collect::<Vec<_>>(), 64.0);
    let near_block = |p: Point, reach: f64| -> bool {
        block_grid.query(p.x - reach, p.y - reach, p.x + reach, p.y + reach).into_iter().any(|k| {
            let ((x0, y0, x1, y1), b) = blocks[k];
            p.x >= x0 - reach && p.x <= x1 + reach && p.y >= y0 - reach && p.y <= y1 + reach
                && (g::contains(b, p) || b.outer.iter().zip(b.outer.iter().cycle().skip(1)).take(b.outer.len())
                    .any(|(&a, &b)| g::distance(p, a, b).0 <= reach))
        })
    };
    // `roadNetworkPrune`: metres of `s` lining a block (the samples below).
    let lined = |s: &Street| -> f64 {
        let reach = s.widths.iter().copied().fold(1.0, f64::max) * 0.5 + 12.0;
        let mut metres = 0.0;
        for w in s.path.windows(2) {
            let length = distance(w[0], w[1]);
            let n = (length / 10.0).ceil().max(1.0) as usize;
            for i in 0..n {
                let p = lerp(w[0], w[1], (i as f64 + 0.5) / n as f64);
                if near_block(p, reach) { metres += length / n as f64; }
            }
        }
        metres
    };
    for s in &land {
        let Some(&c) = s.path.first().and_then(|p| banks.component.get(&key(*p))) else { continue; };
        let length: f64 = s.path.windows(2).map(|w| distance(w[0], w[1])).sum();
        // Outbound transport serves the countryside even without urban lots.
        if matches!(s.role.as_str(), "regional" | "outbound") && length >= 40.0 { served[c] = true; }
        if served[c] || matches!(s.role.as_str(), "track" | "causeway" | "pier" | "mole" | "landing") { continue; }
        let reach = s.widths.iter().copied().fold(1.0, f64::max) * 0.5 + 12.0;
        for w in s.path.windows(2) {
            let length = distance(w[0], w[1]);
            let n = (length / 10.0).ceil().max(1.0) as usize;
            for i in 0..n {
                let p = lerp(w[0], w[1], (i as f64 + 0.5) / n as f64);
                if near_block(p, reach) { frontage[c] += length / n as f64; }
            }
        }
        served[c] |= frontage[c] >= 12.0;
    }
    // `roadNetworkPrune`: built frontage of each bank network, whether or not
    // an outbound road already serves it (a quota crossing must link two).
    laps.lap("inner.served");
    let prune = layout.config.as_ref().is_some_and(|c| c.road_network_prune);
    let mut built = vec![false; served.len()];
    if prune {
        let mut metres = vec![0.0; served.len()];
        for s in &land {
            let Some(&c) = s.path.first().and_then(|p| banks.component.get(&key(*p))) else { continue; };
            if built[c] || matches!(s.role.as_str(), "track" | "causeway" | "pier" | "mole" | "landing") { continue; }
            metres[c] += lined(s);
            built[c] |= metres[c] >= 12.0;
        }
    }
    // `villageBridgeBudget`: a place whose demand is one crossing counts the bank
    // networks the regional road joins on dry land as one bank.
    // `roadNetworkPrune`: any place does (such networks are one bank: a meander
    // the road already passes on land needs no road, bridge, road, bridge chain).
    let budget = layout.config.as_ref().is_some_and(|c| c.village_bridge_budget) && village_crossings(population) || prune;
    let joined = if budget { regional_banks(&land, &banks, network, surface) } else { (0..served.len()).collect() };
    laps.lap("inner.banks");
    if supply && built_bank_crossings(streets, &land, &banks, &served, surface, max_grade, budget.then_some(joined.as_slice())) {
        laps.lap("inner.crossings");
        select_bridges_inner(layout, population, surface, roads, false, max_grade, network);
        return;
    }
    laps.lap("inner.crossings");
    // A regional bridge can land just outside the clipped town. Carry its
    // existing road on far enough to show the outward connection as well.
    let exposed: BTreeSet<_> = spans.iter().flat_map(|s| [s.path[0], *s.path.last().unwrap()])
        .filter_map(|p| banks.component.get(&key(p)).copied()).filter(|&c| !served[c]).collect();
    let mut outward = vec![];
    for s in roads.iter().filter(|s| matches!(s.role.as_str(), "regional" | "outbound")) {
        for reverse in [false, true] {
            let mut path = s.path.clone(); if reverse { path.reverse(); }
            if path.first().and_then(|p| banks.component.get(&key(*p))).is_none_or(|c| !exposed.contains(c)) { continue; }
            let mut kept = vec![path[0]]; let mut left = 120.0;
            for w in path.windows(2) {
                let length = distance(w[0], w[1]);
                if length >= left { kept.push(lerp(w[0], w[1], left / length)); left = 0.0; break; }
                kept.push(w[1]); left -= length;
            }
            if left <= 80.0 && routing::path_clear(surface, &kept, f64::INFINITY) {
                outward.push(Street { widths: vec![width(s, 0); kept.len()], path: kept, rank: s.rank, role: s.role.clone() });
            }
        }
    }
    if !outward.is_empty() {
        streets.extend(outward);
        select_bridges_inner(layout, population, surface, &[], false, max_grade, network);
        return;
    }
    struct Candidate { parts: Vec<usize>, banks: BTreeSet<usize>, built: BTreeSet<usize>, middle: Point, direction: (f64, f64), span: f64, rank: usize, width: f64, valid: bool }
    let mut candidates: Vec<_> = (0..bridges.length.len()).map(|_| Candidate {
        parts: vec![], banks: BTreeSet::new(), built: BTreeSet::new(), middle: Point { x: 0.0, y: 0.0 }, direction: (0.0, 0.0),
        span: 0.0, rank: usize::MAX, width: 0.0, valid: true,
    }).collect();
    for (i, s) in streets.iter().enumerate().filter(|(_, s)| s.role == "bridge") {
        let c = &mut candidates[bridges.component[&key(s.path[0])]];
        c.parts.push(i); c.rank = c.rank.min(s.rank);
        c.width = c.width.max(s.widths.iter().copied().fold(1.0, f64::max));
        let (a, b) = (s.path[0], *s.path.last().unwrap());
        let length = distance(a, b);
        let wet = routing::water_intervals(surface, a, b);
        let span = wet.iter().map(|&(lo, hi)| (hi - lo) * length).sum::<f64>();
        if span > c.span {
            c.span = span; c.direction = ((b.x - a.x) / length, (b.y - a.y) / length);
            c.middle = wet.into_iter()
                .max_by(|a, b| (a.1 - a.0).total_cmp(&(b.1 - b.0)))
                .map_or(lerp(a, b, 0.5), |(lo, hi)| lerp(a, b, (lo + hi) * 0.5));
        }
    }
    for (&p, &i) in &bridges.component {
        let c = &mut candidates[i];
        let bank = banks.component.get(&p).copied().filter(|&b| served[b]);
        if let Some(b) = bank { c.banks.insert(joined[b]); if built[b] { c.built.insert(joined[b]); } }
        // Include split decks as one crossing, but never accept a free end.
        if bridges.degrees[&p] == 1 && bank.is_none() { c.valid = false; }
    }
    #[cfg(test)]
    if std::env::var_os("BRIDGE_TRACE").is_some() {
        for c in &candidates { eprintln!("bridge/select {} rank={} span={:.1} valid={} served={:?} at {:?}", layout.culture, c.rank, c.span, c.valid, c.banks, c.middle); }
    }
    let mut order: Vec<_> = (0..candidates.len()).filter(|&i| candidates[i].valid && candidates[i].span > EPS && !candidates[i].banks.is_empty()).collect();
    order.sort_by(|&a, &b| {
        let (a, b) = (&candidates[a], &candidates[b]);
        a.rank.cmp(&b.rank).then_with(|| b.width.total_cmp(&a.width)).then_with(|| a.span.total_cmp(&b.span))
            .then_with(|| a.parts[0].cmp(&b.parts[0]))
    });
    fn root(parent: &[usize], mut i: usize) -> usize { while parent[i] != i { i = parent[i]; } i }
    laps.lap("inner.candidates");
    let mut channels: Vec<_> = (0..candidates.len()).collect();
    for (n, &i) in order.iter().enumerate() { for &j in &order[..n] {
        let (c, d) = (&candidates[i], &candidates[j]);
        let same_banks = c.banks.len() > 1 && c.banks == d.banks;
        let same_channel = (c.direction.0 * d.direction.0 + c.direction.1 * d.direction.1).abs() >= 0.5
            && distance(c.middle, d.middle) < crossings::street_spacing(c.span.max(d.span), population)
            && (1..8).all(|k| surface.wet(lerp(c.middle, d.middle, k as f64 / 8.0)));
        if same_banks || same_channel { let a = root(&channels, i); let b = root(&channels, j); channels[b] = a; }
    }}
    let mut groups: BTreeMap<_, Vec<usize>> = BTreeMap::new();
    for &i in &order { groups.entry(root(&channels, i)).or_default().push(i); }
    let mut parent: Vec<_> = (0..served.len()).collect();
    let mut kept: Vec<usize> = vec![];
    let mut is_kept = vec![false; candidates.len()];
    // A spanning forest of served bank networks is mandatory, regardless of
    // count or spacing. A second inhabited part can never be suppressed.
    for &i in &order {
        let c = &candidates[i];
        let bank = root(&parent, *c.banks.first().unwrap());
        if c.banks.iter().all(|&b| root(&parent, b) == bank) { continue; }
        kept.push(i);
        is_kept[i] = true;
        for &other in &c.banks { let other = root(&parent, other); parent[other] = bank; }
    }
    // `apart[i]`: distance from candidate `i` to the nearest kept member of its group.
    let mut apart = vec![f64::INFINITY; candidates.len()];
    for group in groups.values() {
        let mut extent: f64 = 0.0;
        for &i in group { for &j in group { extent = extent.max(distance(candidates[i].middle, candidates[j].middle)); } }
        let target = crossings::street_count(population, extent);
        let spacing = (extent / target as f64 * 0.7).max(40.0);
        let mut count = group.iter().filter(|&&i| is_kept[i]).count();
        for &i in group {
            apart[i] = group.iter().filter(|&&j| is_kept[j])
                .map(|&j| distance(candidates[i].middle, candidates[j].middle)).fold(f64::INFINITY, f64::min);
        }
        while count < target {
            // `roadNetworkPrune`: a quota crossing joins two built banks; a
            // deck outside the houses stays only where the forest needs it.
            let Some(i) = group.iter().copied().filter(|&i| !is_kept[i] && (!prune || candidates[i].built.len() >= 2)).min_by(|&i, &j| {
                let (a, b) = (apart[i], apart[j]);
                (a < spacing).cmp(&(b < spacing))
                    .then(candidates[i].rank.cmp(&candidates[j].rank))
                    .then_with(|| b.total_cmp(&a)).then_with(|| candidates[j].width.total_cmp(&candidates[i].width))
                    .then(i.cmp(&j))
            }) else { break; };
            kept.push(i);
            is_kept[i] = true;
            count += 1;
            for &j in group { apart[j] = apart[j].min(distance(candidates[j].middle, candidates[i].middle)); }
        }
    }
    laps.lap("inner.choice");
    let selected: BTreeSet<_> = kept.into_iter().flat_map(|i| candidates[i].parts.iter().copied()).collect();
    let mut i = 0;
    streets.retain(|s| { let keep = s.role != "bridge" || selected.contains(&i); i += 1; keep });
}
