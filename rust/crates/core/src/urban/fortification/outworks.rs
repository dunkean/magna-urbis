//! Build outer walls, barbicans, wengcheng and citadels.

use crate::rng::Rng;
use crate::urban::{Enclosure, Gatehouse, Point, Shape, Work, geometry as g};
use super::build::{BuildContext, Works, free};
use super::gate_works::GateInfo;
use super::geometry::{
    Cut, TILE, V, add, buffer, closed, dir,
    disc, dist, dot, normals, pt, quad, tiles,
    unit,
};
use super::moat::Moat;
use super::street_clearance::{Near, final_width};
use super::towers::bastion;

#[allow(clippy::too_many_arguments)]
pub(super) fn outer_works(
    ctx: &BuildContext<'_>,
    e: &Enclosure,
    infos: &[GateInfo],
    major_land: &[usize],
    works: &mut Works,
    rng: &Rng,
) -> Vec<Shape> {
    let &BuildContext { style, poly, face, clear, inner_core, streets, predicted, height, tower_height, c, surface, .. } = ctx;
    let Works { towers, gatehouses, bastion_union, outworks, extra_reserve, occupied, .. } = works;
    let mut moat_core: Vec<Shape> = buffer(poly, face.max(0.1));
    moat_core.extend(bastion_union.iter().cloned());
    moat_core.extend(towers.iter().map(|t| t.footprint.clone()));
    moat_core.extend(gatehouses.iter().flat_map(|gh| gh.masses.clone()));
    if ctx.has("outer-wall") || ctx.has("antemural") {
        let kind = if ctx.has("outer-wall") {
            "outer-wall"
        } else {
            "antemural"
        };
        let mut gr = rng.fork("outer");
        let gap = face
            + gr.range(
                style.outer_gap[0],
                style.outer_gap[1].max(style.outer_gap[0]),
            );
        if let Some(o) = buffer(poly, gap)
            .into_iter()
            .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
        {
            let mut r = o.outer.clone();
            r.push(r[0]);
            let mut r = g::simplify(&r, 2.0, |_| false);
            r.pop();
            let o = g::normalized(Shape {
                outer: r,
                holes: vec![],
            });
            let band = buffer(&o, style.outer_width);
            let strip: Vec<Shape> = band.iter().flat_map(|b| g::difference(b, &o)).collect();
            let strip = {
                let near = Near::new(&closed(&o.outer), 16.0);
                let mut cuts = vec![];
                for s in streets {
                    let half = s.widths.iter().copied().fold(3.0, f64::max) * 0.5 + 0.5;
                    for w in s.path.windows(2) {
                        // A street running inside the band: the wall never stands on it.
                        if near.distance(w[0], w[1]) <= style.outer_width + half && dist(w[0], w[1]) > 0.1 {
                            let u = dir(w[0], w[1]);
                            cuts.push(quad(w[0],u,(u.1,-u.0),[-half,dist(w[0],w[1])+half],[-half,half]));
                        }
                        for i in near.crossed(w[0], w[1]) {
                            let a = o.outer[i % o.outer.len()]; let b = o.outer[(i+1) % o.outer.len()];
                            if let Some((_, p)) = g::segment_hit(w[0], w[1], a, b) {
                                let t = dir(a,b); let u = dir(w[0],w[1]);
                                let sin = (t.0*u.1-t.1*u.0).abs();
                                if sin > 0.3 { cuts.push(quad(p,t,(t.1,-t.0),[-half/sin,half/sin],[-style.outer_width-1.0,style.outer_width+1.0])); }
                                else {
                                    // A grazing street: open the wall along the street's own ribbon.
                                    let reach = (style.outer_width+1.0)/sin.max(0.05)+half;
                                    cuts.push(quad(p,u,(u.1,-u.0),[-reach.min(dist(w[0],p)),reach.min(dist(p,w[1]))],[-half,half]));
                                }
                            }
                        }
                    }
                }
                g::union(&Cut::new(cuts).from(tiles(strip,TILE)))
            };
            // Between the walls (outside the main curtain by construction).
            let lists = clear.from(tiles(g::difference(&o, poly), TILE));
            // Rule 3 for a wall: the outer wall stops at the water.
            for p in strip {
                for d in g::dry_clip(&surface, &p) {
                    if g::area(&d) > 4.0 {
                        outworks.push(Work {
                            kind: kind.into(),
                            shape: d,
                            height_m: style.outer_height,
                            passage: None,
                        });
                    }
                }
            }
            extra_reserve.extend(lists);
            moat_core.extend(band.iter().cloned());
            if ctx.has("barbican") {
                let mut oring = o.outer.clone();
                oring.push(oring[0]);
                let ons = normals(&oring);
                let near_outer = Near::new(&oring, 30.0);
                for st in streets
                    .iter()
                    .filter(|s| s.role != "wall-lane" && s.rank <= 1)
                {
                    for (si, w) in st.path.windows(2).enumerate() {
                        for k in near_outer.crossed(w[0], w[1]) {
                            let edge = [oring[k], oring[k + 1]];
                            let Some((_, x)) = g::segment_hit(w[0], w[1], edge[0], edge[1]) else {
                                continue;
                            };
                            let mut s = dir(w[0], w[1]);
                            if dot(s, ons[k]) < 0.0 {
                                s = (-s.0, -s.1);
                            }
                            let wd = final_width(st, si, true, predicted);
                            let across = (-s.1, s.0);
                            let block = quad(
                                x,
                                s,
                                across,
                                [-1.0, 10.0],
                                [-(wd + 8.0) * 0.5, (wd + 8.0) * 0.5],
                            );
                            if !ctx.dry_points(&block) {
                                continue;
                            }
                            let pieces: Vec<Shape> = clear
                                .from(vec![block])
                                .into_iter()
                                .filter(|p| g::area(p) >= 10.0)
                                .collect();
                            if pieces.iter().any(|p| !free(occupied, p)) {
                                continue;
                            }
                            for p in &pieces {
                                moat_core.push(p.clone());
                                occupied.add(p.clone());
                            }
                            for p in pieces {
                                outworks.push(Work {
                                    kind: "barbican".into(),
                                    shape: p,
                                    height_m: style.outer_height + 2.0,
                                    passage: Some([add(x, s, -1.0), add(x, s, 10.0)]),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    if ctx.has("wengcheng") {
        let mut cr = rng.fork("wengcheng");
        let round = style.tower_shape == "round";
        for &gi in major_land {
            let info = &infos[gi];
            let q = e.gates[gi];
            let radius = cr.range(style.court_radius[0], style.court_radius[1]);
            let k = 0.8 * c;
            let base = add(q, info.n, face);
            let (outer, inner) = if round {
                let semi = |r: f64| {
                    let a0 = info.t.1.atan2(info.t.0);
                    let mut o: Vec<Point> = (0..=12)
                        .map(|j| {
                            let a = a0 + j as f64 * std::f64::consts::PI / 12.0;
                            pt(base.x + r * a.cos(), base.y + r * a.sin())
                        })
                        .collect();
                    // the half that lies outward
                    if dot(dir(base, o[6]), info.n) < 0.0 {
                        o = o
                            .iter()
                            .map(|p| pt(2.0 * base.x - p.x, 2.0 * base.y - p.y))
                            .collect();
                    }
                    o.push(add(base, info.n, -0.5));
                    g::normalized(Shape {
                        outer: o,
                        holes: vec![],
                    })
                };
                (semi(radius), semi(radius - k))
            } else {
                (
                    quad(base, info.t, info.n, [-radius, radius], [-0.5, radius]),
                    quad(
                        base,
                        info.t,
                        info.n,
                        [-(radius - k), radius - k],
                        [-0.5, radius - k],
                    ),
                )
            };
            if ctx.dry_share(std::slice::from_ref(&outer)) < 0.9 || !ctx.dry_points(&outer) {
                continue;
            }
            let walls = clear.from(inner_core.from(g::difference(&outer, &inner)));
            if walls.is_empty() {
                continue;
            }
            // The court's outer gate, where a street really leaves the court:
            // its crossing of the court wall line (radius - k/2) nearest to
            // the straight run from the gate.
            let mid_line = if round {
                let a0 = info.t.1.atan2(info.t.0);
                let mut o: Vec<Point> = (0..=24)
                    .map(|j| {
                        let a = a0 + j as f64 * std::f64::consts::PI / 24.0;
                        let r = radius - k * 0.5;
                        pt(base.x + r * a.cos(), base.y + r * a.sin())
                    })
                    .collect();
                if dot(dir(base, o[12]), info.n) < 0.0 {
                    o = o
                        .iter()
                        .map(|p| pt(2.0 * base.x - p.x, 2.0 * base.y - p.y))
                        .collect();
                }
                o
            } else {
                let r = radius - k * 0.5;
                vec![
                    add(base, info.t, -r),
                    add(add(base, info.t, -r), info.n, r),
                    add(add(base, info.t, r), info.n, r),
                    add(base, info.t, r),
                ]
            };
            let guess = add(
                q,
                info.s,
                (face + radius - k * 0.5) / dot(info.s, info.n).max(0.3),
            );
            let (cx0, cy0, cx1, cy1) = g::bbox(&outer);
            let mut exit: Option<(f64, Point, V, f64)> = None;
            for st in streets.iter().filter(|s| s.role != "wall-lane") {
                for (si, w) in st.path.windows(2).enumerate() {
                    if w[0].x.max(w[1].x) < cx0
                        || w[0].x.min(w[1].x) > cx1
                        || w[0].y.max(w[1].y) < cy0
                        || w[0].y.min(w[1].y) > cy1
                    {
                        continue;
                    }
                    for e2 in mid_line.windows(2) {
                        if let Some((_, x)) = g::segment_hit(w[0], w[1], e2[0], e2[1]) {
                            let d = dist(x, guess);
                            if exit.is_none_or(|b| d < b.0) {
                                exit = Some((
                                    d,
                                    x,
                                    dir(w[0], w[1]),
                                    final_width(st, si, true, predicted),
                                ));
                            }
                        }
                    }
                }
            }
            // A court no street leaves would close its gate: not built.
            let Some((_, x, mut sx, wx)) = exit else {
                continue;
            };
            moat_core.push(outer.clone());
            extra_reserve.extend(clear.from(inner_core.from(vec![inner])));
            for p in walls.into_iter().filter(|p| g::area(p) >= 10.0) {
                outworks.push(Work {
                    kind: "wengcheng".into(),
                    shape: p,
                    height_m: height,
                    passage: None,
                });
            }
            if dot(sx, dir(base, x)) < 0.0 {
                sx = (-sx.0, -sx.1);
            }
            let pw = wx + 1.0;
            let across = (-sx.1, sx.0);
            let block = quad(
                x,
                sx,
                across,
                [-k * 0.5 - 2.0, k * 0.5 + 2.0],
                [-pw * 0.5 - 3.0, pw * 0.5 + 3.0],
            );
            if ctx.dry_points(&block) {
                let masses: Vec<Shape> = clear
                    .from(inner_core.from(vec![block.clone()]))
                    .into_iter()
                    .filter(|m| g::area(m) >= 4.0)
                    .collect();
                if !masses.is_empty() && masses.iter().all(|m| free(occupied, m)) {
                    for m in &masses {
                        occupied.add(m.clone());
                    }
                    gatehouses.push(Gatehouse {
                        gate: gi,
                        kind: "tower".into(),
                        shape: block,
                        masses,
                        passage: [add(x, sx, -k * 0.5 - 2.0), add(x, sx, k * 0.5 + 2.0)],
                        passage_width_m: pw,
                        height_m: tower_height,
                    });
                }
            }
        }
    }
    moat_core
}

/// Place a bastioned pentagon outside the highest available salient.
pub(super) fn citadel(
    ctx: &BuildContext<'_>,
    moat: Moat,
    outworks: &mut Vec<Work>,
    ditch: &mut Vec<Work>,
    rng: &Rng,
) {
    let &BuildContext { n_seg, ring, ns, poly, face, wet, clear, surface, streets, height, .. } = ctx;
    let Moat { berm, dw, ditch_kind, depth, .. } = moat;
    if ctx.has("citadel") && rng.fork("citadel").chance(0.5) {
        let mut cr = rng.fork("citadel-size");
        let rc = cr.range(90.0, 120.0);
        let mut salients: Vec<usize> = (0..n_seg)
            .filter(|&i| {
                let prev = (i + n_seg - 1) % n_seg;
                dot(ns[prev], dir(ring[i], ring[(i + 1) % n_seg])) < 0.0 && !wet[prev] && !wet[i]
            })
            .collect();
        salients.sort_by(|&a, &b| {
            surface
                .height_at(ring[b])
                .total_cmp(&surface.height_at(ring[a]))
                .then(a.cmp(&b))
        });
        let barrier = Cut::new(buffer(poly, face + berm + dw + 5.0));
        for &i in salients.iter().take(6) {
            let prev = (i + n_seg - 1) % n_seg;
            let b = unit((ns[prev].0 + ns[i].0, ns[prev].1 + ns[i].1));
            let centre = add(ring[i], b, rc + face + dw + berm + 10.0);
            let phase = (-b.1).atan2(-b.0);
            let penta = g::normalized(disc(centre, rc, 5, phase));
            if barrier.hits(&penta) > 1.0
                || ctx.dry_share(std::slice::from_ref(&penta)) < 0.9
                || !ctx.dry_points(&penta)
                || streets.iter().any(|s| {
                    s.path.windows(2).any(|w| {
                        g::contains(&penta, w[0])
                            || penta
                                .outer
                                .iter()
                                .zip(penta.outer.iter().cycle().skip(1))
                                .any(|(&x, &y)| g::segment_hit(w[0], w[1], x, y).is_some())
                    })
                })
            {
                continue;
            }
            let pr = penta.outer.clone();
            let mut pp = pr.clone();
            pp.push(pr[0]);
            let pns = normals(&pp);
            let mut parts = vec![penta.clone()];
            for k in 0..5 {
                let (a, v, bb) = (pr[(k + 4) % 5], pr[k], pr[(k + 1) % 5]);
                let d = (0.15 * dist(a, v)).clamp(12.0, 30.0);
                if let Some(s) =
                    bastion(ctx, v, dir(a, v), dir(v, bb), pns[(k + 4) % 5], pns[k], d, false)
                {
                    parts.push(s);
                }
            }
            let citadel = g::union(&parts);
            if citadel.len() != 1 || ctx.dry_share(&citadel) < 0.9 {
                continue;
            }
            let citadel = citadel.into_iter().next().unwrap();
            if let Some(kind) = ditch_kind {
                let ring_d: Vec<Shape> = buffer(&citadel, berm + dw)
                    .iter()
                    .flat_map(|o| g::difference(o, &citadel))
                    .collect();
                for p in clear.from(ring_d) {
                    for d in g::dry_clip(&surface, &p) {
                        if g::area(&d) > 20.0 {
                            ditch.push(Work {
                                kind: kind.into(),
                                shape: d,
                                height_m: depth,
                                passage: None,
                            });
                        }
                    }
                }
            }
            outworks.push(Work {
                kind: "citadel".into(),
                shape: citadel,
                height_m: height * 0.8,
                passage: None,
            });
            break;
        }
    }
}
