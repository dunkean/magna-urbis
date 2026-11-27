//! Lay out lean-tos and the dead-end lanes that serve their gate fronts.

use crate::rng::Rng;
use crate::urban::{Attached, Enclosure, Shape, Street, geometry as g};
use super::build::{BuildContext, Works};
use super::gate_works::GateInfo;
use super::geometry::{Cut, add, area, cross, dir, dist, dot, quad};
use super::moat::Moat;
use super::shore::WallWalk;
use super::street_clearance::Near;

/// Gap between a lean-to front and the ribbon of the lane serving it (m).
const LEAN_GAP: f64 = 0.6;
/// A faubourg house against the wall holds one narrow dwelling or shop
/// (a gabled row house at most): never deeper or wider.
const LEAN_MAX_DEPTH: f64 = 12.0;
const LEAN_MAX_FRONT: f64 = 12.0;

pub(super) struct GateFronts {
    pub(super) attached: Vec<Attached>,
    pub(super) lanes: Vec<Street>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn lean_tos(
    ctx: &BuildContext<'_>,
    walk: &WallWalk<'_>,
    e: &Enclosure,
    infos: &[GateInfo],
    major_land: &[usize],
    works: &Works,
    moat: Moat,
    rng: &Rng,
) -> GateFronts {
    let &BuildContext { style, path, surface, predicted, face, steep, wet, .. } = ctx;
    let Works { towers, gatehouses, bastions, outworks, .. } = works;
    let Moat { ditch_kind, .. } = moat;
    // --- faubourg gate fronts: lean-tos against the outer face beside the
    // major gates, each row with the lane that serves it (a dead end off the
    // gate street, round the gate structures), only on a circuit without a
    // moat, so a lean-to is never in a ditch, a glacis or a gate passage. No front
    // on steep or water-side runs, nor where a glacis or ravelins hold the
    // approaches (no-build zone).
    let mut attached: Vec<Attached> = vec![];
    let mut lanes: Vec<Street> = vec![];
    if style.attached > 0.0 && ditch_kind.is_none() && !ctx.has("glacis") && !ctx.has("ravelin") {
        let held: Vec<Shape> = towers
            .iter()
            .map(|t| t.footprint.clone())
            .chain(gatehouses.iter().flat_map(|gh| gh.masses.clone()))
            .chain(bastions.iter().map(|b| b.shape.clone()))
            .chain(outworks.iter().map(|w| w.shape.clone()))
            .collect();
        let occupied = Cut::new(held.clone());
        let curtain = Near::new(path, 30.0);
        let lw = predicted.widths[3].clamp(2.5, 5.0);
        let margin = 1.0;
        for &gi in major_land {
            let info = &infos[gi];
            let q = e.gates[gi];
            let mut ar = rng.fork(&format!("attached:{gi}"));
            if !ar.chance(style.attached) {
                continue;
            }
            let k = walk.segment_of(q);
            if steep[k] || wet[k] {
                continue;
            }
            let sn = dot(info.s, info.n).max(0.25);
            let base = add(q, info.n, face);
            // Gate street at offset `o` from the outer face, and its signed
            // position along the curtain there.
            let road = |o: f64| add(q, info.s, (face + o) / sn);
            let road_along = |o: f64| (face + o) / sn * dot(info.s, info.t);
            let half_road = info.width * 0.5 / cross(info.t, info.s).abs().max(0.5);
            // Structures near the gate in the (along, out) frame.
            let frame: Vec<(f64, f64, f64)> = held
                .iter()
                .filter(|s| s.outer.iter().any(|&p| dist(p, q) < 90.0))
                .map(|s| {
                    s.outer.iter().fold(
                        (f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
                        |(a0, a1, o1), &p| {
                            let v = (p.x - base.x, p.y - base.y);
                            let (a, o) = (dot(v, info.t), dot(v, info.n));
                            (a0.min(a), a1.max(a), o1.max(o))
                        },
                    )
                })
                .collect();
            for side in [-1.0, 1.0] {
                // Deeper than a lean-to is a house of its own: such a
                // culture keeps the drawn lean-to as decor only.
                let [min_front, min_depth] = predicted.dwelling;
                let depth = ar.range(5.0, 7.0).max(if min_depth <= LEAN_MAX_DEPTH { min_depth } else { 0.0 });
                let o1 = depth + LEAN_GAP + lw * 0.5;
                let end = (if side > 0.0 {
                    dist(q, path[k + 1])
                } else {
                    dist(q, path[k])
                } - 2.0)
                    .min(60.0);
                // Structures on this side, along measured away from the gate.
                let mine: Vec<(f64, f64, f64)> = frame
                    .iter()
                    .map(|&(a0, a1, o)| {
                        if side > 0.0 {
                            (a0, a1, o)
                        } else {
                            (-a1, -a0, o)
                        }
                    })
                    .filter(|&(_, a1, _)| a1 > 0.0)
                    .collect();
                // Lane corner: the first gap past the gate cluster wide
                // enough for the lane ribbon and its margin.
                let road_at = (side * road_along(o1)).max(0.0);
                let clearance = lw * 0.5 + margin;
                let mut ac = road_at + half_road + clearance;
                loop {
                    let next = mine
                        .iter()
                        .filter(|&&(a0, a1, _)| a0 < ac + clearance && a1 + clearance > ac)
                        .map(|&(_, a1, _)| a1 + clearance)
                        .fold(ac, f64::max);
                    if next <= ac + 1e-9 {
                        break;
                    }
                    ac = next;
                }
                // Lane top: in front of every structure between the gate
                // and the corner.
                let o2 = mine
                    .iter()
                    .filter(|&&(a0, _, _)| a0 < ac)
                    .map(|&(_, _, o)| o + clearance)
                    .fold(o1, f64::max);
                if o2 > o1 + 20.0 || ac + lw * 0.5 + LEAN_GAP + 5.0 > end {
                    continue;
                }
                let along = (info.t.0 * side, info.t.1 * side);
                let at = |a: f64, o: f64| add(add(base, along, a), info.n, o);
                let first = attached.len();
                let mut a = ac + lw * 0.5 + LEAN_GAP;
                while a < end {
                    let f = ar.range(5.0, 9.0).max(min_front.min(LEAN_MAX_FRONT));
                    if a + f > end {
                        break;
                    }
                    let unit_shape = quad(base, along, info.n, [a, a + f], [0.0, depth]);
                    let probe = quad(
                        base,
                        along,
                        info.n,
                        [a - 2.0, a + f + 2.0],
                        [0.0, depth + 2.0],
                    );
                    if occupied.hits(&probe) > 0.01 || !ctx.dry_points(&unit_shape) {
                        break;
                    }
                    let full = g::area(&unit_shape);
                    let pieces = ctx.clip(unit_shape);
                    if area(&pieces) < 0.6 * full {
                        break;
                    }
                    let hm = ar.range(4.0, 6.0);
                    for p in pieces {
                        attached.push(Attached {
                            kind: "lean-to".into(),
                            side: "out".into(),
                            shape: p,
                            height_m: hm,
                        });
                    }
                    a += f;
                }
                if attached.len() == first {
                    continue;
                }
                // The lane: along the row front, round the gate structures,
                // onto the gate street (0.5 m past its axis, so the junction
                // is a real crossing).
                let top = at(ac, o2);
                let meet = road(o2);
                let mut lane = vec![at(a + 0.5, o1), at(ac, o1)];
                if o2 > o1 + 0.25 {
                    lane.push(top);
                }
                lane.push(add(meet, dir(top, meet), 0.5));
                let ribbon = g::ribbon(&lane, &vec![lw + 2.0 * LEAN_GAP; lane.len()]);
                let lane_clear = ribbon.iter().all(|r| occupied.hits(r) <= 0.01)
                    && lane
                        .windows(2)
                        .all(|w| curtain.distance(w[0], w[1]) >= face + lw * 0.5 + LEAN_GAP)
                    && lane.iter().all(|&p| !surface.wet(p));
                if !lane_clear {
                    attached.truncate(first);
                    continue;
                }
                lanes.push(Street {
                    widths: vec![lw; lane.len()],
                    path: lane,
                    rank: 3,
                    role: "lane".into(),
                });
            }
        }
    }
    GateFronts { attached, lanes }
}
