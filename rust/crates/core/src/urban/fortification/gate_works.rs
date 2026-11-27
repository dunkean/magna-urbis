//! Lay out land gatehouses and the abutments and towers of water passages.

use crate::urban::{Enclosure, Gatehouse, Point, Shape, geometry as g, macroplan};
use super::build::{BuildContext, Works, free};
use super::geometry::{V, add, cross, dir, dist, dot, pt, quad};
use super::shore::{WallWalk, water_passages};
use super::street_clearance::final_width;
use super::towers::tower_at;

pub(super) struct GateInfo {
    /// A regional road (or its approach) crosses here: it enters the town
    /// through a gatehouse, before any city street claims the place.
    regional: bool,
    pub(super) major: bool,
    pub(super) width: f64,
    /// Street direction, pointing outward.
    pub(super) s: V,
    /// Curtain tangent and outward normal at the gate.
    pub(super) t: V,
    pub(super) n: V,
}

pub(super) fn gate_params(kind: &str, c: f64) -> Option<(f64, f64)> {
    // (outward depth, side mass)
    match kind {
        "timber" => Some((5.0, 2.0)),
        "tower" => Some((10.0, 4.0)),
        "twin-tower" => Some((12.0, 4.0)),
        "bab" => Some((16.0, 6.0)),
        "postern" => Some((c.max(3.0) + 1.0, 2.0)),
        "ravelin" => Some((c + 2.0, 4.0)),
        _ => None,
    }
}

pub(super) fn gate_info(ctx: &BuildContext<'_>, walk: &WallWalk<'_>, e: &Enclosure, land: usize) -> Vec<GateInfo> {
    let &BuildContext { path, ns, streets, predicted, .. } = ctx;
    // Gates: street, rank and direction at each land crossing.
    e.gates[..land]
        .iter()
        .map(|&q| {
            let k = walk.segment_of(q);
            let (t, n) = (dir(path[k], path[k + 1]), ns[k]);
            let mut best: Option<(usize, f64, V)> = None;
            let mut regional = false;
            for st in streets.iter().filter(|s| s.role != "wall-lane") {
                for (i, w) in st.path.windows(2).enumerate() {
                    let on = g::distance(q, w[0], w[1]).0 < 0.1;
                    regional |= on && matches!(st.role.as_str(), "regional" | "approach");
                    if on && best.is_none_or(|b| st.rank < b.0) {
                        let wd = final_width(st, i, true, predicted);
                        best = Some((st.rank, wd, dir(w[0], w[1])));
                    }
                }
            }
            let (rank, width, mut s) = best.unwrap_or((2, 4.0, n));
            if dot(s, n) < 0.0 {
                s = (-s.0, -s.1);
            }
            if dot(s, n) < 0.25 {
                // A street grazing the curtain: build the gate square to it.
                s = n;
            }
            GateInfo {
                regional,
                major: rank <= 1,
                width,
                s,
                t,
                n,
            }
        })
        .collect()
}

pub(super) fn land_gatehouses(
    ctx: &BuildContext<'_>,
    e: &Enclosure,
    infos: &[GateInfo],
    pop: u32,
    works: &mut Works,
    gate_clear: &mut [f64],
) {
    let &BuildContext { style, h, c, inner_core, height, tower_height, clear, .. } = ctx;
    let Works { towers, gatehouses, occupied, .. } = works;
    // --- gatehouses (land gates), the most important crossings first: a
    // crossing whose masses would stand on a gatehouse (or another work)
    // already built stays a plain opening (`free`); `gate_budget::GATE_GAP`
    // keeps the gates themselves apart.
    let mut order: Vec<usize> = (0..infos.len()).collect();
    order.sort_by(|&a, &b| {
        infos[b]
            .regional
            .cmp(&infos[a].regional)
            .then(infos[b].major.cmp(&infos[a].major))
            .then(infos[b].width.total_cmp(&infos[a].width))
            .then(a.cmp(&b))
    });
    for gi in order {
        let info = &infos[gi];
        let q = e.gates[gi];
        gate_clear[gi] = info.width * 0.5 + 4.0;
        let kind = if info.major && pop >= style.gate_min_pop {
            style.gate_major.as_str()
        } else if info.major {
            // Below the gatehouse population a main road still passes a built
            // gate (the minor one), never a bare gap in the curtain.
            if gate_params(&style.gate_minor, c).is_some() { style.gate_minor.as_str() } else { "opening" }
        } else {
            style.gate_minor.as_str()
        };
        let Some((depth, mass)) = gate_params(kind, c) else {
            continue;
        };
        let pw = info.width + 1.0;
        let across = (-info.s.1, info.s.0);
        let back = h / dot(info.s, info.n).max(0.3) + 0.5;
        let half = pw * 0.5 + mass;
        let block = quad(q, info.s, across, [-back, depth], [-half, half]);
        if !ctx.dry_points(&block) {
            gate_clear[gi] = half + 4.0;
            continue;
        }
        let shape = inner_core
            .from(vec![block.clone()])
            .into_iter()
            .max_by(|a, b| g::area(a).total_cmp(&g::area(b)));
        let Some(shape) = shape else { continue };
        // Rule 2 then rule 4: the side masses keep off every street and every
        // structure already placed; a gatehouse with no mass left is not built.
        let masses: Vec<Shape> = clear
            .from(vec![shape.clone()])
            .into_iter()
            .filter(|m| g::area(m) >= 4.0)
            .collect();
        if masses.is_empty() || masses.iter().any(|m| !free(occupied, m)) {
            continue;
        }
        let gh = match kind {
            "timber" => tower_height,
            "tower" if style.gate_height > 0.0 && info.major => style.gate_height,
            "tower" => tower_height + 2.0,
            "twin-tower" => height + 2.0,
            "bab" => height + 3.0,
            _ => height,
        };
        let sin = cross(info.t, info.s).abs().max(0.5);
        gate_clear[gi] = half / sin + 3.0;
        for m in &masses {
            occupied.add(m.clone());
        }
        gatehouses.push(Gatehouse {
            gate: gi,
            kind: kind.into(),
            shape,
            masses,
            passage: [add(q, info.s, -back), add(q, info.s, depth)],
            passage_width_m: pw,
            height_m: gh,
        });
        if kind == "twin-tower" || (style.gate_towers && info.major) {
            let r = style.tower_radius[1];
            for side in [-1.0, 1.0] {
                let anchor = add(q, info.t, side * (half / sin + r));
                if let Some(tw) = tower_at(
                    ctx,
                    anchor,
                    info.t,
                    info.n,
                    &style.tower_shape,
                    r,
                    0.0,
                    "gate",
                    tower_height,
                ) && free(occupied, &tw.footprint)
                {
                    gate_clear[gi] = gate_clear[gi].max(dist(anchor, q) + r + 2.0);
                    occupied.add(tw.footprint.clone());
                    towers.push(tw);
                }
            }
        }
    }
}

pub(super) fn water_gatehouses(
    ctx: &BuildContext<'_>,
    walk: &WallWalk<'_>,
    e: &Enclosure,
    banks: &[(Point, bool)],
    works: &mut Works,
) {
    let &BuildContext { path, n_seg, h, face, ns, height, tower_height, surface, style, .. } = ctx;
    let Works { towers, gatehouses, occupied, .. } = works;
    // --- water gates: pair each entry into the water with the next exit. On the surface every
    // passage is a channel a gate spans (`water::gate_spans`); in a cave a rock face stays open (`shore`).
    let has_towers = style.corner_turn.is_some() || style.tower_spacing.is_some();
    if !banks.is_empty() {
        for (a, b) in water_passages(banks) {
            let shore = style.cave && {
                let (first, last) = (walk.segment_of(a), walk.segment_of(b));
                let (mut wet, mut river, mut transverse, mut samples) = (false, true, 0, 0);
                for offset in 0..n_seg {
                    let i = (first+offset)%n_seg;
                    let p = if offset == 0 { a } else { path[i] };
                    let q = if i == last { b } else { path[i+1] };
                    let steps = (dist(p,q)/4.0).ceil().max(1.0) as usize;
                    for k in 0..=steps {
                        let at = pt(p.x+(q.x-p.x)*k as f64/steps as f64,p.y+(q.y-p.y)*k as f64/steps as f64);
                        if surface.wet(at) {
                            wet = true; river &= macroplan::harbour::water_code(surface,at) == 3;
                            let t = dir(p,q); let normal = (t.1,-t.0);
                            let probe = (surface.width / surface.n.max(1) as f64 * 1.5).max(8.0);
                            samples += 1;
                            if surface.wet(add(at,normal,probe)) && surface.wet(add(at,normal,-probe)) { transverse += 1; }
                        }
                    }
                    if i == last { break; }
                }
                // A stream narrower than the 4 m sampling stays a water gate.
                wet && !(river && transverse * 2 >= samples)
            };
            let Some(gi) = (0..e.gates.len())
                .min_by(|&x, &y| dist(e.gates[x], a).total_cmp(&dist(e.gates[y], a)))
            else {
                continue;
            };
            if dist(e.gates[gi], a) > 8.0 {
                continue;
            }
            // The curtain always opens over the water between the two banks
            // (the span is the gate); each bank gets an abutment where dry
            // land allows one.
            let mut abut = vec![];
            for (bank, sign) in [(a, -1.0), (b, 1.0)] {
                // Abutment on dry land, back from the bank along the curtain.
                let sk = walk.segment_of(bank);
                let t = dir(path[sk], path[sk + 1]);
                let along = (t.0 * sign, t.1 * sign); // pointing onto land
                // Abutment and tower stay on this curtain segment, never
                // past its end on the tangent (a lone tower on a spit).
                let avail = if sign > 0.0 { dist(bank, path[sk + 1]) } else { dist(bank, path[sk]) };
                // The first dry offset back from the bank: a curtain meeting
                // the water obliquely needs a few metres more.
                let Some(back) = [1.0, 3.0, 6.0, 10.0, 15.0, 22.0, 30.0, 40.0]
                    .into_iter()
                    .find(|&b| {
                        b + 5.0 <= avail && ctx.dry_points(&quad(
                            add(bank, along, b),
                            along,
                            ns[sk],
                            [0.0, 5.0],
                            [-h, face + 1.0],
                        ))
                    })
                else {
                    continue;
                };
                abut.push(quad(
                    add(bank, along, back),
                    along,
                    ns[sk],
                    [0.0, 5.0],
                    [-h, face + 1.0],
                ));
                if has_towers {
                    let r = style.tower_radius[1];
                    if let Some(tw) = [1.5, 4.0, 8.0].into_iter().filter(|&b| back + 2.0 * r + b <= avail).find_map(|b| {
                        tower_at(
                            ctx,
                            add(bank, along, back + r + b),
                            t,
                            ns[sk],
                            &style.tower_shape,
                            r,
                            0.0,
                            "water",
                            tower_height,
                        )
                        .filter(|tw| free(occupied, &tw.footprint))
                    }) {
                        occupied.add(tw.footprint.clone());
                        towers.push(tw);
                    }
                }
            }
            let masses: Vec<Shape> = abut
                .into_iter()
                .flat_map(|s| ctx.clip(s))
                .filter(|m| g::area(m) >= 2.0 && free(occupied, m))
                .collect();
            for m in &masses {
                occupied.add(m.clone());
            }
            // Without an abutment the span itself stands for the gate.
            let shape = masses
                .iter()
                .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
                .cloned()
                .unwrap_or_else(|| {
                    let t = dir(a, b);
                    quad(a, t, (t.1, -t.0), [0.0, dist(a, b)], [-face - h, face + h])
                });
            gatehouses.push(Gatehouse {
                gate: gi,
                kind: if shore { "shore" } else { "water" }.into(),
                shape,
                masses,
                passage: [a, b],
                passage_width_m: dist(a, b),
                height_m: height,
            });
        }
    }
}
