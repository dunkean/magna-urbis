//! Match gates to street crossings and guard new main gates.

use crate::urban::{Enclosure, Gatehouse, Point, Shape, Street, Surface, composition, geometry as g};
use super::gate_budget::GATE_GAP;
use super::gate_works::gate_params;
use super::geometry::{Cut, V, add, cross, dir, dist, dot, normals, quad, ribbon_half};
use super::style::styled;

/// Invariant (a main road enters through a gatehouse): a land gate whose
/// street is a main street (rank 0–1) or a regional road, and which no
/// gatehouse guards yet (a crossing opened after `build`), gets the culture's
/// gate block, square to its street, off the street ribbons (`clear`) and off
/// the other structures. Where no such block fits (water, a tower) the
/// opening stays as it is.
pub(super) fn guard_main_gates(e: &mut Enclosure, streets: &[&Street], clear: &Cut, culture: &str, pop: u32, surface: Surface<'_>) {
    if e.style.is_empty() || e.path.len() < 4 {
        return;
    }
    let style = styled(&e.style, culture, pop);
    let kind = if pop >= style.gate_min_pop { style.gate_major.clone() } else { style.gate_minor.clone() };
    let c = if e.curtain_width_m > 0.0 { e.curtain_width_m } else { style.curtain_width };
    let Some((depth, mass)) = gate_params(&kind, c) else { return };
    let h = ribbon_half(&e.kind);
    let ns = normals(&e.path);
    // A gate outranks a flanking or corner tower: those give way to its gatehouse (removed below).
    let mut held = Cut::new(
        e.towers_detail
            .iter()
            .filter(|t| !matches!(t.kind.as_str(), "flank" | "corner"))
            .map(|t| t.footprint.clone())
            .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.iter().cloned()))
            .chain(e.bastions.iter().map(|w| w.shape.clone()))
            .collect(),
    );
    let moat = Cut::new(e.ditch.iter().map(|d| d.shape.clone()).collect());
    let guarded: Vec<usize> = e.gatehouses.iter().map(|gh| gh.gate).collect();
    for gi in 0..e.gates.len() {
        if guarded.contains(&gi) {
            continue;
        }
        let q = e.gates[gi];
        let k = e
            .path
            .windows(2)
            .enumerate()
            .min_by(|a, b| g::distance(q, a.1[0], a.1[1]).0.total_cmp(&g::distance(q, b.1[0], b.1[1]).0))
            .map_or(0, |(k, _)| k);
        let tangent = dir(e.path[k], e.path[k + 1]);
        // The main street through this gate: (along the curtain, rank, width, direction). A street that
        // crosses the curtain (over 30°) wins over one that only meets the gate point along the wall.
        let mut best: Option<(usize, usize, f64, V)> = None;
        for st in streets {
            let main = (matches!(st.role.as_str(), "regional" | "approach") || st.rank <= 1)
                && !matches!(st.role.as_str(), "bridge" | "ford" | "causeway" | "quay" | "pier" | "boardwalk" | "landing" | "mole" | "wall-lane");
            if !main {
                continue;
            }
            let rank = if matches!(st.role.as_str(), "regional" | "approach") { 0 } else { st.rank };
            for (i, w) in st.path.windows(2).enumerate() {
                // Through the gate point, or ending on it (a regional road entering from the network).
                if g::distance(q, w[0], w[1]).0 >= st.widths.get(i).copied().unwrap_or(6.0) * 0.5 + 2.0 || dist(w[0], w[1]) <= 0.1 {
                    continue;
                }
                let along = usize::from(cross(dir(w[0], w[1]), tangent).abs() < 0.5);
                if best.is_none_or(|b| (along, rank) < (b.0, b.1)) {
                    best = Some((along, rank, st.widths.get(i).copied().unwrap_or(6.0), dir(w[0], w[1])));
                }
            }
        }
        let Some((_, _, width, mut s)) = best else { continue };
        let n = ns[k];
        if dot(s, n) < 0.0 {
            s = (-s.0, -s.1);
        }
        if dot(s, n) < 0.25 {
            s = n;
        }
        let pw = width + 1.0;
        let across = (-s.1, s.0);
        let back = h / dot(s, n).max(0.3) + 0.5;
        let half = pw * 0.5 + mass;
        // The block keeps off the street ribbons, to the dry land (on a bank, a bridge approach) and out
        // of the ditch, which runs on in front of it (the gate street crosses it: `resolve_moats`
        // records that crossing): the deepest block that keeps masses there, else none.
        let Some((depth, block, masses)) = [depth, depth * 0.5, c - h + 1.0].into_iter().find_map(|d| {
            let block = quad(q, s, across, [-back, d], [-half, half]);
            if block.outer.iter().any(|&p| surface.wet(p)) {
                return None;
            }
            let masses: Vec<Shape> = moat.from(clear.from(vec![block.clone()])).into_iter().filter(|m| g::area(m) >= 4.0).collect();
            (!masses.is_empty()).then_some((d, block, masses))
        }) else {
            continue;
        };
        if masses.iter().any(|m| held.hits(m) > 0.5) {
            continue;
        }
        let block_cut = Cut::new(masses.clone());
        e.towers_detail.retain(|t| !matches!(t.kind.as_str(), "flank" | "corner") || block_cut.hits(&t.footprint) <= 0.5);
        e.towers = e.towers_detail.iter().map(|t| t.anchor).collect();
        for m in &masses {
            held.add(m.clone());
            e.reserve.push(m.clone());
        }
        e.gatehouses.push(Gatehouse {
            gate: gi,
            kind: kind.clone(),
            shape: block,
            masses,
            passage: [add(q, s, -back), add(q, s, depth)],
            passage_width_m: pw,
            height_m: e.height_m.max(style.height) + 2.0,
        });
    }
}

/// Invariant (a curtain is crossed by a street only at a gate): the gates
/// are the real crossings of `streets` with the curtain, plus the water
/// gates (their passage ends) and the ends of regional accesses; a point where
/// the curtain only touches a bank is no gate (it would cut the river wall). A gate no street crosses any more closes, a
/// crossing without a gate opens a plain one. Returns the old gate index ->
/// new index map (for the gatehouses).
pub(super) fn reconcile_gates(e: &mut Enclosure, streets: &[Street], fixed: bool) -> Vec<Option<usize>> {
    let crossings = composition::gates(&e.path, streets);
    let water_ends: Vec<Point> = e
        .gatehouses
        .iter()
        .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
        .flat_map(|gh| gh.passage)
        .collect();
    let bank = |p: Point| water_ends.iter().any(|&q| dist(p, q) < 1.0);
    let mut remap: Vec<Option<usize>> = vec![None; e.gates.len()];
    let mut gates: Vec<Point> = vec![];
    let referenced: Vec<usize> = e
        .gatehouses
        .iter()
        .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
        .map(|gh| gh.gate)
        .collect();
    for (i, &q) in e.gates.iter().enumerate() {
        let access = streets.iter().filter(|s| matches!(s.role.as_str(), "regional" | "approach"))
            .any(|s| s.path.first().into_iter().chain(s.path.last()).any(|&p|
                dist(p,q)<s.widths.iter().copied().fold(0.0,f64::max)*0.5+2.0));
        if crossings.iter().any(|&c| dist(c, q) < 2.0) || referenced.contains(&i) || bank(q) || access {
            remap[i] = Some(gates.len());
            gates.push(q);
        } else if std::env::var("URBAN_PROFILE").is_ok() {
            let crossing = crossings.iter().map(|&c| dist(c, q)).fold(f64::INFINITY, f64::min);
            let near: Vec<String> = streets.iter().filter_map(|s| {
                let d = s.path.windows(2).map(|w| crate::urban::geometry::distance(q, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
                (d < 30.0 && s.path.len() >= 2).then(|| format!("{} {:.0} m, ends ({:.0},{:.0}) ({:.0},{:.0})", s.role, d, s.path[0].x, s.path[0].y, s.path[s.path.len() - 1].x, s.path[s.path.len() - 1].y))
            }).collect();
            eprintln!("  gates: ({:.0},{:.0}) of {} closes, nearest crossing {crossing:.0} m; streets: {}", q.x, q.y, e.edit_key, near.join("; "));
        }
    }
    // A crossing opens a plain gate only `GATE_GAP` m from every other gate: a street crossing nearer
    // than that is cut at the wall (`close_crossings`) and led to the gate beside it.
    for c in crossings.into_iter().filter(|_| !fixed) {
        if !gates.iter().any(|&q| dist(c, q) < GATE_GAP) {
            gates.push(c);
        }
    }
    e.gates = gates;
    remap
}
