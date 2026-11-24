//! Close unserved street crossings and stop dead ends at the curtain face.

use crate::urban::{Enclosure, Layout, Point, Shape, Street, Surface, geometry as g, network};
use super::gate_budget;
use super::geometry::{Box2, cross, dir, dist, pt, ribbon_half};
use super::street_clearance::Near;

/// Invariant (a street stops at the wall face): a street end that no other
/// street meets (a dead end) on the curtain body or in the reserve (berm,
/// ditch, glacis, a tower's foot) is cut back to where the street leaves
/// them. Only a street through a gate crosses the curtain, so no dead end
/// carves a slot into the wall or the ditch; a lane ending beside an outer
/// lean-to serves it and keeps its end, and a street that crosses the curtain
/// before ending in the outer reserve is a gate street (its causeway): it is
/// never cut back through the wall, which would close its gate. The corridor
/// freed on the curtain body returns to the reserve.
pub(super) fn stop_at_curtains(streets: &mut Vec<Street>, enclosures: &mut [Enclosure]) {
    struct Zone {
        near: Near,
        half: f64,
        reserve: Vec<(Shape, Box2)>,
        lean: Vec<Shape>,
        body: Vec<Shape>,
        ring: Shape,
    }
    let zones: Vec<Option<Zone>> = enclosures
        .iter()
        .map(|e| {
            (!e.style.is_empty() && e.path.len() >= 4).then(|| {
                let half = ribbon_half(&e.kind);
                Zone {
                    near: Near::new(&e.path, 8.0),
                    half,
                    reserve: e.reserve.iter().map(|s| (s.clone(), g::bbox(s))).collect(),
                    lean: e
                        .attached
                        .iter()
                        .filter(|a| a.side == "out")
                        .map(|a| a.shape.clone())
                        .collect(),
                    body: g::ribbon(&e.path, &[2.0 * half]),
                    ring: g::normalized(Shape {
                        outer: e.path[..e.path.len() - 1].to_vec(),
                        holes: vec![],
                    }),
                }
            })
        })
        .collect();
    let inside = |z: &Zone, p: Point| {
        z.near.distance(p, p) < z.half - 1e-6
            || z.reserve.iter().any(|(s, b)| {
                p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 && g::contains(s, p)
            })
    };
    let key = |p: Point| ((p.x * 100.0).round() as i64, (p.y * 100.0).round() as i64);
    let mut degree: std::collections::HashMap<(i64, i64), usize> = Default::default();
    for s in streets.iter() {
        for &p in &s.path {
            *degree.entry(key(p)).or_default() += 1;
        }
    }
    let mut freed: Vec<(usize, Vec<Point>, Vec<f64>)> = vec![];
    let mut gone = vec![false; streets.len()];
    for (i, s) in streets.iter_mut().enumerate() {
        if matches!(
            s.role.as_str(),
            "wall-lane" | "bridge" | "ford" | "causeway" | "quay" | "pier" | "boardwalk" | "landing" | "mole"
        ) || s.path.len() < 2
        {
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        for end in [true, false] {
            if gone[i] {
                break;
            }
            let p = if end {
                *s.path.last().unwrap()
            } else {
                s.path[0]
            };
            let hw = s.widths[if end { s.path.len() - 1 } else { 0 }] * 0.5;
            let Some(z) = zones
                .iter()
                .position(|z| z.as_ref().is_some_and(|z| inside(z, p)))
            else {
                continue;
            };
            let zone = zones[z].as_ref().unwrap();
            if degree.get(&key(p)).copied().unwrap_or(0) != 1
                || zone.lean.iter().any(|l| {
                    g::contains(l, p)
                        || (0..l.outer.len()).any(|k| {
                            let (a, b) = (l.outer[k], l.outer[(k + 1) % l.outer.len()]);
                            g::distance(p, a, b).0 < hw + 2.0
                        })
                })
            {
                continue;
            }
            if !end {
                s.path.reverse();
                s.widths.reverse();
            }
            // Walk back from the end, every 0.25 m, to the first point out.
            let n = s.path.len();
            let mut cut = None;
            'walk: for k in (0..n - 1).rev() {
                let (a, b) = (s.path[k], s.path[k + 1]);
                let steps = (dist(a, b) / 0.25).ceil().max(1.0) as usize;
                for j in 1..=steps {
                    let t = 1.0 - j as f64 / steps as f64;
                    let q = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                    if !inside(zone, q) {
                        let w = s.widths[k] + (s.widths[k + 1] - s.widths[k]) * t;
                        cut = Some((k, q, w));
                        break 'walk;
                    }
                }
            }
            // A street through the curtain ending in the outer reserve
            // passes a gate (the causeway over the ditch): it keeps its gate.
            if let Some((_, q, _)) = cut
                && zone.near.distance(p, p) >= zone.half
                && g::contains(&zone.ring, q) != g::contains(&zone.ring, p)
            {
                if !end {
                    s.path.reverse();
                    s.widths.reverse();
                }
                continue;
            }
            match cut {
                Some((k, q, w)) => {
                    let mut out = vec![q];
                    out.extend_from_slice(&s.path[k + 1..]);
                    let mut ws = vec![w];
                    ws.extend_from_slice(&s.widths[k + 1..]);
                    freed.push((z, out, ws));
                    s.path.truncate(k + 1);
                    s.widths.truncate(k + 1);
                    if dist(*s.path.last().unwrap(), q) > 1e-3 {
                        s.path.push(q);
                        s.widths.push(w);
                    }
                    if s.path.len() < 2 {
                        gone[i] = true;
                    }
                }
                None => {
                    freed.push((z, s.path.clone(), s.widths.clone()));
                    gone[i] = true;
                }
            }
            if !end {
                s.path.reverse();
                s.widths.reverse();
            }
        }
    }
    let mut k = 0;
    streets.retain(|_| {
        k += 1;
        !gone[k - 1]
    });
    for (z, path, widths) in freed {
        let body = &zones[z].as_ref().unwrap().body;
        let ws: Vec<f64> = widths.iter().map(|w| w + 1.0).collect();
        let back: Vec<Shape> = g::ribbon(&path, &ws)
            .iter()
            .flat_map(|r| body.iter().flat_map(|b| g::intersection(r, b)))
            .filter(|s| g::area(s) > 0.5)
            .collect();
        enclosures[z].reserve.extend(back);
    }
}

/// A crossing within this distance (m) of a gate or of a water passage is that gate's street.
const GATE_REACH: f64 = 8.0;
/// A street that crosses a curtain within this distance (m) of a bridge deck is the way of that
/// bridge into the town. A curtain stands on every bank, so the crossing is kept and
/// `reconcile_gates` opens its gate: a bridge never leads to a blank wall.
const BRIDGE_GATE: f64 = 30.0;
/// Bridge gates stand at least this far (m) from each other and from the gates of the circuit: the
/// street of a bridge nearer than that to a gate goes through that gate.
const BRIDGE_GATE_SPACING: f64 = 60.0;
/// Invariant (every crossing of a curtain is a gate): a street that crosses a
/// curtain away from its gates and its water passages opens no bare gap in the
/// wall: it is split there, each side ending clear of the curtain body
/// (`stop_at_curtains` then pulls the ends out of the berm and the moat). The
/// quarter on each side keeps its own streets; the town is entered through the
/// gates. Decks and waterside ways pass (`gate_budget::water_way`), and so
/// does the street at a bridge head (`BRIDGE_GATE`). With
/// `main_too` every other street is held to it; without, only the lesser ones
/// (`gate_budget::priority` under 2) and every bridge ramp: a main road laid
/// after the gates were decided keeps its crossing, and `reconcile_gates` opens
/// its gate.
///
/// A cut ramp keeps its approach role only on the piece that meets its bridge.
pub(super) fn close_crossings(streets: &mut Vec<Street>, enclosures: &[Enclosure], main_too: bool, surface: Surface<'_>) {
    let passages: Vec<_> = enclosures.iter().flat_map(|e| &e.gatehouses)
        .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
        .map(|gh| (gh.passage[0], gh.passage[1]))
        .collect();
    close_crossings_at(streets, enclosures, main_too, surface, &passages);
}

pub(super) fn close_crossings_at(streets: &mut Vec<Street>, enclosures: &[Enclosure], main_too: bool, surface: Surface<'_>, passages: &[(Point, Point)]) {
    let walls: Vec<(Near, f64, &Enclosure)> = enclosures
        .iter()
        .filter(|e| !e.style.is_empty() && e.path.len() >= 4)
        .map(|e| (Near::new(&e.path, 16.0), ribbon_half(&e.kind).max(e.curtain_width_m * 0.5), e))
        .collect();
    if walls.is_empty() {
        return;
    }
    let heads: Vec<Point> = streets.iter().filter(|s| s.role == "bridge")
        .flat_map(|s| s.path.first().into_iter().chain(s.path.last()).copied()).collect();
    let mut bridge_gates: Vec<Point> = vec![];
    let mut landings = std::collections::HashSet::new();
    if main_too {
        for deck in streets.iter().filter(|s| s.role == "bridge") {
            landings.extend(deck.path.first().into_iter().chain(deck.path.last()).map(|&p| network::key(p)));
        }
    }
    let mut out: Vec<Street> = Vec::with_capacity(streets.len());
    for mut s in std::mem::take(streets) {
        let lesser = gate_budget::priority(&s) < 2;
        let held = !gate_budget::water_way(&s, false) && (main_too || s.role == "approach" || lesser && s.role != "outbound");
        if !held || s.path.len() < 2 {
            out.push(s);
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        let n = s.path.len();
        let cum: Vec<f64> = std::iter::once(0.0)
            .chain(s.path.windows(2).scan(0.0, |acc, w| {
                *acc += dist(w[0], w[1]);
                Some(*acc)
            }))
            .collect();
        // Spans (arc along the street) to remove around each stray crossing.
        let mut spans: Vec<(f64, f64)> = vec![];
        for (i, w) in s.path.windows(2).enumerate() {
            let l = dist(w[0], w[1]);
            for (near, half, e) in &walls {
                for k in near.crossed(w[0], w[1]) {
                    let (a, b) = (e.path[k], e.path[k + 1]);
                    let Some((t, x)) = g::segment_hit(w[0], w[1], a, b) else { continue };
                    // A street end resting on the curtain is no crossing.
                    if (i == 0 && t * l < 0.6) || (i + 2 == n && (1.0 - t) * l < 0.6) {
                        continue;
                    }
                    if e.gates.iter().any(|&q| dist(q, x) < GATE_REACH)
                        || passages.iter().any(|&(p, q)| g::distance(x, p, q).0 < GATE_REACH)
                        || gate_budget::water_way(&s, surface.wet(x))
                        || bridge_gates.iter().any(|&q| dist(q, x) < GATE_REACH)
                    {
                        continue;
                    }
                    if heads.iter().any(|&b| dist(b, x) < BRIDGE_GATE)
                        && e.gates.iter().chain(&bridge_gates).all(|&q| dist(q, x) >= BRIDGE_GATE_SPACING)
                    {
                        bridge_gates.push(x);
                        continue;
                    }
                    let sin = cross(dir(w[0], w[1]), dir(a, b)).abs().max(0.3);
                    let clear = (half + s.widths[i].max(s.widths[i + 1]) * 0.5) / sin + 0.5;
                    let at = cum[i] + t * l;
                    spans.push((at - clear, at + clear));
                }
            }
        }
        if spans.is_empty() {
            out.push(s);
            continue;
        }
        spans.sort_by(|a, b| a.0.total_cmp(&b.0));
        let total = cum[n - 1];
        // Kept intervals between the removed spans.
        let mut keep: Vec<(f64, f64)> = vec![];
        let mut from = 0.0_f64;
        for (a, b) in spans {
            if a > from {
                keep.push((from, a));
            }
            from = from.max(b);
        }
        if from < total {
            keep.push((from, total));
        }
        let at = |d: f64| -> (Point, f64) {
            let i = (0..n - 1).find(|&i| cum[i + 1] >= d).unwrap_or(n - 2);
            let l = (cum[i + 1] - cum[i]).max(1e-9);
            let t = ((d - cum[i]) / l).clamp(0.0, 1.0);
            let (p, q) = (s.path[i], s.path[i + 1]);
            (pt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t), s.widths[i] + (s.widths[i + 1] - s.widths[i]) * t)
        };
        for (a, b) in keep.into_iter().filter(|(a, b)| b - a >= 1.0) {
            let (p0, w0) = at(a);
            let (p1, w1) = at(b);
            let mut path = vec![p0];
            let mut widths = vec![w0];
            for i in 1..n - 1 {
                if cum[i] > a + 1e-6 && cum[i] < b - 1e-6 {
                    path.push(s.path[i]);
                    widths.push(s.widths[i]);
                }
            }
            path.push(p1);
            widths.push(w1);
            let role = if main_too && lesser && s.role == "approach"
                && !landings.contains(&network::key(p0)) && !landings.contains(&network::key(p1)) {
                if s.rank <= 2 { "street" } else { "lane" }
            } else {
                s.role.as_str()
            };
            out.push(Street { path, widths, rank: s.rank, role: role.into() });
        }
    }
    *streets = out;
}

/// Invariant (a curtain is crossed only at its gates) on the plan the quarters
/// drew: the gates were decided on the armature (`gate_budget::decide`); a
/// street drawn since that crosses a curtain elsewhere ends at the wall on both
/// sides. Called before the first trim, so the allocation reads the streets the
/// walls leave.
pub(in super::super) fn enforce(layout: &mut Layout, surface: Surface<'_>) {
    if layout.enclosures.iter().all(|e| e.style.is_empty() || e.path.len() < 4) {
        return;
    }
    close_crossings(&mut layout.streets, &layout.enclosures, true, surface);
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures);
}
