//! Place towers and bastions on corners, fronts and gate approaches.

use crate::rng::Rng;
use crate::urban::{Enclosure, Point, Shape, Tower, Work, geometry as g};
use super::build::{BuildContext, Works, free};
use super::geometry::{Cut, V, add, cross, dir, disc, dist, dot, pt, quad, turn_at, unit};

#[allow(clippy::too_many_arguments)]
pub(super) fn tower_at(
    ctx: &BuildContext<'_>,
    anchor: Point,
    t: V,
    n: V,
    shape: &str,
    r: f64,
    depth: f64,
    kind: &str,
    height: f64,
) -> Option<Tower> {
    let &BuildContext { surface, h, .. } = ctx;
    if surface.wet(anchor) {
        return None;
    }
    let (center, nominal) = match shape {
        "square" => {
            let c0 = add(anchor, n, r - h);
            (c0, quad(c0, t, n, [-r, r], [-r, r]))
        }
        "rect" => {
            let c0 = add(anchor, n, depth * 0.5 - h);
            (c0, quad(anchor, t, n, [-r, r], [-h, depth - h]))
        }
        "d" => {
            let c0 = add(anchor, n, r - h);
            let mut outer = vec![add(add(c0, t, -r), n, -r), add(add(c0, t, r), n, -r)];
            for k in 0..=8 {
                let a = k as f64 * std::f64::consts::PI / 8.0;
                outer.push(pt(
                    c0.x + r * (a.cos() * t.0 + a.sin() * n.0),
                    c0.y + r * (a.cos() * t.1 + a.sin() * n.1),
                ));
            }
            (
                c0,
                g::normalized(Shape {
                    outer,
                    holes: vec![],
                }),
            )
        }
        _ => {
            let c0 = add(anchor, n, r - h);
            (c0, disc(c0, r, 16, t.1.atan2(t.0)))
        }
    };
    if !ctx.dry_points(&nominal) {
        return None;
    }
    let full = g::area(&nominal);
    let piece = ctx.clip(nominal)
        .into_iter()
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
    (g::area(&piece) >= 0.6 * full).then(|| Tower {
        anchor,
        center,
        shape: shape.into(),
        radius_m: r,
        depth_m: if shape == "rect" { depth } else { 0.0 },
        angle: t.1.atan2(t.0),
        height_m: height,
        kind: kind.into(),
        footprint: piece,
    })
}

/// A bastion with flanks about 0.4 of a face, as on a Vauban front.
#[allow(clippy::too_many_arguments)]
pub(super) fn bastion(ctx: &BuildContext<'_>, v: Point, u: V, w: V, n1: V, n2: V, d: f64, flat: bool) -> Option<Shape> {
    let surface = ctx.surface;
    let f = 0.6 * d + 8.0;
    let cap = (2.2 * d).clamp(25.0, 60.0);
    let b = unit((n1.0 + n2.0, n1.1 + n2.1));
    let f1 = add(v, u, -d);
    let f2 = add(v, w, d);
    let tip = add(v, b, cap);
    let mut outer = vec![f1, add(f1, n1, f), tip, add(f2, n2, f), f2];
    if !flat {
        outer.push(v);
    }
    let s = g::normalized(Shape {
        outer,
        holes: vec![],
    });
    (g::simple(&s) && ctx.dry_points(&s) && !surface.wet(add(v, b, cap * 0.5))).then_some(s)
}

/// Stations on each front between hard corners. Fine contour vertices must
/// not restart the spacing; relief/water stretch the local metre by `factor`.
pub(super) fn flank_stations(path: &[Point], corners: &[bool], factors: &[f64], spacing: f64) -> Vec<(usize, f64)> {
    let n = path.len() - 1;
    let first = (0..n).find(|&i| corners[i]).unwrap_or(0);
    let lengths: Vec<_> = (0..n).map(|i| dist(path[i], path[i + 1]) / factors[i]).collect();
    let mut stations = vec![];
    let mut run = vec![];
    for k in 0..n {
        let i = (first + k) % n;
        run.push(i);
        if !corners[(i + 1) % n] && k + 1 < n { continue; }
        let total: f64 = run.iter().map(|&i| lengths[i]).sum();
        let count = (total / spacing).floor() as usize;
        let (mut segment, mut before) = (0, 0.0);
        for j in 1..=count {
            let at = j as f64 * total / (count + 1) as f64;
            while segment + 1 < run.len() && before + lengths[run[segment]] < at {
                before += lengths[run[segment]];
                segment += 1;
            }
            let i = run[segment];
            stations.push((i, ((at - before) / lengths[i].max(1e-12)).clamp(0.0, 1.0)));
        }
        run.clear();
    }
    stations
}

pub(super) fn towers_and_bastions(
    ctx: &BuildContext<'_>,
    e: &Enclosure,
    gate_clear: &[f64],
    works: &mut Works,
    rng: &Rng,
) {
    let &BuildContext { style, path, n_seg, ring, ns, height, tower_height, steep, wet, .. } = ctx;
    let Works { towers, bastions, bastion_union, occupied, .. } = works;
    let near_gate = |p: Point, extra: f64| {
        e.gates
            .iter()
            .zip(gate_clear)
            .any(|(&q, &r)| dist(p, q) < r + extra)
    };
    let near_tower =
        |p: Point, towers: &[Tower], d: f64| towers.iter().any(|t| dist(p, t.anchor) < d);

    // --- bastions at the salients (bastioned trace)
    let bastioned = style.id == "bastioned";
    let mut bastion_at = vec![false; n_seg];
    if bastioned {
        // A bastion keeps 60 % of its nominal area in one piece (a street may
        // graze it, not cut it in two), off every structure already placed;
        // its rampart stands level with the curtain.
        let accept = |s: Shape,
                      bastions: &mut Vec<Work>,
                      union: &mut Vec<Shape>,
                      occupied: &mut Cut|
         -> bool {
            let full = g::area(&s);
            let pieces: Vec<Shape> = ctx.clip(s).into_iter().filter(|p| g::area(p) >= 4.0).collect();
            if pieces.iter().map(g::area).fold(0.0, f64::max) < 0.6 * full
                || pieces.iter().any(|p| !free(occupied, p))
            {
                return false;
            }
            for p in pieces {
                union.push(p.clone());
                occupied.add(p.clone());
                bastions.push(Work {
                    kind: "bastion".into(),
                    shape: p,
                    height_m: height,
                    passage: None,
                });
            }
            true
        };
        for i in 0..n_seg {
            let prev = (i + n_seg - 1) % n_seg;
            let (a, v, b) = (ring[prev], ring[i], ring[(i + 1) % n_seg]);
            let (u, w) = (dir(a, v), dir(v, b));
            let turn = cross(u, w).atan2(dot(u, w));
            // Convex: turning towards the inside (away from the outward normal).
            let convex = dot(ns[prev], w) < 0.0;
            let deg = turn.abs().to_degrees();
            if !convex || !(15.0..=110.0).contains(&deg) || wet[prev] && wet[i] {
                continue;
            }
            let d = (0.15 * dist(a, v).min(dist(v, b))).clamp(12.0, 30.0);
            if d > 0.45 * dist(a, v).min(dist(v, b)) {
                continue;
            }
            // Near a gate the bastion only has to keep off its gatehouse and
            // its street (`accept`); a smaller one is tried before a tower.
            for k in [1.0, 0.7, 0.5] {
                if let Some(s) = bastion(ctx, v, u, w, ns[prev], ns[i], (d * k).max(10.0), false)
                    && accept(s, bastions, bastion_union, occupied)
                {
                    bastion_at[i] = true;
                    break;
                }
            }
        }
        // Long fronts get flat bastions, one per ~260 m of curtain, away
        // from the gates and from the corner bastions.
        for i in 0..n_seg {
            let (a, b) = (path[i], path[i + 1]);
            let l = dist(a, b);
            let count = (l / 260.0).floor() as usize;
            if count == 0 || wet[i] {
                continue;
            }
            let u = dir(a, b);
            let d = (0.15 * l / count as f64 * 0.5).clamp(12.0, 30.0);
            for k in 0..count {
                let m = add(a, u, (k as f64 + 0.5) * l / count as f64);
                if near_gate(m, d + 10.0) {
                    continue;
                }
                if let Some(s) = bastion(ctx, m, u, u, ns[i], ns[i], d, true) {
                    accept(s, bastions, bastion_union, occupied);
                }
            }
        }
    }
    // --- corner towers (and a tower where a bastion could not stand)
    if let Some(min_turn) = style.corner_turn.or(bastioned.then_some(15.0)) {
        let r = style.tower_radius[1];
        for i in 0..n_seg {
            if bastion_at[i] {
                continue;
            }
            let prev = (i + n_seg - 1) % n_seg;
            let (a, v, b) = (ring[prev], ring[i], ring[(i + 1) % n_seg]);
            let (u, w) = (dir(a, v), dir(v, b));
            let deg = cross(u, w).atan2(dot(u, w)).abs().to_degrees();
            let convex = dot(ns[prev], w) < 0.0;
            if deg <= min_turn || (style.salients_only || bastioned) && !convex {
                continue;
            }
            if near_gate(v, r) || near_tower(v, towers, 2.0 * r + 1.0) {
                continue;
            }
            let bis = unit((ns[prev].0 + ns[i].0, ns[prev].1 + ns[i].1));
            let tan = (-bis.1, bis.0);
            if let Some(tw) = tower_at(
                ctx,
                v,
                tan,
                bis,
                &style.tower_shape,
                r,
                0.0,
                "corner",
                tower_height,
            ) && free(occupied, &tw.footprint)
            {
                occupied.add(tw.footprint.clone());
                towers.push(tw);
            }
        }
    }
    // --- flanking towers at a regular spacing
    if let Some(sp) = style.tower_spacing {
        let mut tr = rng.fork("towers");
        let spacing = tr.range(sp[0], sp[1].max(sp[0]));
        let r = style.tower_radius[0];
        let corners: Vec<_> = (0..n_seg).map(|i|
            turn_at(&path[..n_seg], i).to_degrees() > style.corner_turn.unwrap_or(35.0)).collect();
        let factors: Vec<_> = (0..n_seg).map(|i| if !style.medieval && (steep[i] || wet[i]) { 1.5 } else { 1.0 }).collect();
        for (i, fraction) in flank_stations(path, &corners, &factors, spacing) {
            let (a, b) = (path[i], path[i + 1]);
            let s = spacing * factors[i];
            let (t, n) = (dir(a, b), ns[i]);
            let p = add(a, t, fraction * dist(a, b));
            if near_gate(p, r) || near_tower(p, towers, s * 0.5) {
                continue;
            }
            if let Some(tw) = tower_at(ctx, p, t, n, &style.flank_shape, r,
                style.flank_depth, "flank", tower_height) && free(occupied, &tw.footprint)
            {
                occupied.add(tw.footprint.clone());
                towers.push(tw);
            }
        }
    }
}
