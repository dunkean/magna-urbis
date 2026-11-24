//! Choose, shape and clip the ditch, berm, glacis and ravelins.

use crate::rng::Rng;
use crate::urban::{Enclosure, Point, Shape, Surface, Work, geometry as g, par};
use super::build::{BuildContext, Works};
use super::gate_works::GateInfo;
use super::geometry::{
    Box2, Cut, TILE, add, area, buffer, buffer_all,
    dir, dist, quad, segment_relief, tiles, wet_outward,
};
use super::shore::WallWalk;
use super::options;
use super::parameters;

#[derive(Clone, Copy)]
pub(super) struct Moat {
    pub(super) berm: f64,
    pub(super) dw: f64,
    pub(super) ditch_kind: Option<&'static str>,
    pub(super) depth: f64,
}

pub(super) fn choose_moat(ctx: &BuildContext<'_>, dr: &mut Rng, size: f64, dw: f64) -> Moat {
    let &BuildContext { style, path, n_seg, surface, face, ns, wet, .. } = ctx;
    // --- ditch: decided once per circuit; a wet ditch where water is near
    // and the ground is level, otherwise dry with the style's probability.
    // Decided before the faubourg fronts: a moated circuit keeps its moat
    // whole and has no lean-to outside (rule: the moat wins over the houses).
    let berm = style.berm * size;
    let ditch_kind = match style.ditch.as_str() {
        "none" => None,
        _ if style.ditch_wetness.is_some() => Some("dry"),
        "wet" => Some("wet"),
        "dry" => dr.chance(style.ditch_p).then_some("dry"),
        _ if style.dry_ditches => Some("dry"),
        _ => {
            let near_water = wet.iter().any(|&w| w)
                || (0..n_seg).any(|i| {
                    wet_outward(path[i], path[i + 1], ns[i], surface, face + berm + dw) > 0.0
                });
            let level = (0..n_seg)
                .map(|i| {
                    dist(path[i], path[i + 1])
                        * segment_relief(path[i], path[i + 1], ns[i], surface)
                })
                .sum::<f64>()
                / (0..n_seg)
                    .map(|i| dist(path[i], path[i + 1]))
                    .sum::<f64>()
                    .max(1.0)
                < 0.05;
            if near_water && level {
                Some("wet")
            } else {
                dr.chance(style.ditch_p).then_some("dry")
            }
        }
    };
    // Underdark: no water moat in a cave (a culture's dry ditch stays, across the passages).
    let ditch_kind = if style.cave && ditch_kind == Some("wet") { None } else { ditch_kind };
    // Depth of the ditch (3D moat): the style's, else from its width.
    let depth = if style.ditch_depth > 0.0 { style.ditch_depth } else { (dw * 0.35).clamp(1.5, 4.0) };
    Moat { berm, dw, ditch_kind, depth }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn dig_moat(
    ctx: &BuildContext<'_>,
    walk: &WallWalk<'_>,
    e: &Enclosure,
    infos: &[GateInfo],
    major_land: &[usize],
    works: &mut Works,
    moat: Moat,
    moat_core: Vec<Shape>,
    fronts: Vec<Shape>,
    shore_gaps: &[(f64, f64)],
    rng: &Rng,
) -> Vec<Work> {
    let &BuildContext { style, path, n_seg, poly, face, ns, inner_core, height, clear, street_lines, steep, surface, .. } = ctx;
    let Moat { berm, dw, ditch_kind, depth } = moat;
    let Works { towers, gatehouses, bastion_union, outworks, extra_reserve, .. } = works;
    // --- ditch pieces (kind decided above).
    let mut ditch: Vec<Work> = vec![];
    let mut glacis: Vec<Shape> = vec![];
    let moat_core = g::union(&moat_core);
    let ravelins_wanted = ctx.has("ravelin") && ditch_kind.is_some();
    let mut ravelin_cut: Vec<Shape> = vec![];
    let mut ravelin_ditch: Vec<Shape> = vec![];
    if ravelins_wanted {
        for &gi in major_land {
            let info = &infos[gi];
            let q = e.gates[gi];
            let base = add(q, info.n, face + berm + dw * 0.5);
            let tri = g::normalized(Shape {
                outer: vec![
                    add(base, info.t, -30.0),
                    add(base, info.n, 35.0),
                    add(base, info.t, 30.0),
                ],
                holes: vec![],
            });
            // Rule 4: one ravelin per front; a gate close to a built one
            // shares it.
            if ctx.dry_share(std::slice::from_ref(&tri)) < 0.9
                || !ctx.dry_points(&tri)
                || ravelin_cut
                    .iter()
                    .any(|r| area(&g::intersection(r, &tri)) > 1.0)
            {
                continue;
            }
            let pieces = clear.from(inner_core.from(
                bastion_union.iter().fold(vec![tri.clone()], |acc, b| {
                    acc.iter().flat_map(|p| g::difference(p, b)).collect()
                }),
            ));
            let pieces: Vec<Shape> = Cut::new(
                towers
                    .iter()
                    .map(|t| t.footprint.clone())
                    .chain(gatehouses.iter().flat_map(|gh| gh.masses.clone()))
                    .collect(),
            )
            .from(pieces);
            if area(&pieces) < 0.6 * g::area(&tri) {
                continue;
            }
            ravelin_cut.push(tri.clone());
            ravelin_ditch.extend(
                buffer(&tri, 8.0)
                    .iter()
                    .flat_map(|b| g::difference(b, &tri)),
            );
            for p in pieces.into_iter().filter(|p| g::area(p) >= 30.0) {
                outworks.push(Work {
                    kind: "ravelin".into(),
                    shape: p,
                    height_m: height * 0.8,
                    passage: Some([add(base, info.s, -dw * 0.5), add(base, info.s, 40.0)]),
                });
            }
        }
    }
    // A run that faces natural water within 40 m outside digs none: the water is its moat (cave
    // rock is no water).
    let waterside = |i: usize| !style.cave && [10.0, 20.0, 30.0, 40.0].iter().any(|&off| wet_outward(path[i], path[i + 1], ns[i], surface, off) > 0.3);
    // No ditch along steep or water-side runs, nor at a faubourg gate front.
    // A run's no-ditch zone stops square at its ends: the ditch of the next,
    // dry and level run goes on round the corner up to the water or the
    // slope instead of stopping tens of metres short of it.
    let no_ditch = Cut::new(
        (0..n_seg)
            .filter(|&i| steep[i] || waterside(i))
            .map(|i| {
                let (a, b) = (path[i], path[i + 1]);
                let t = dir(a, b);
                let wd = face + berm + dw + 30.0;
                quad(a, t, ns[i], [0.0, dist(a, b)], [-wd, wd])
            })
            .chain(fronts)
            // A shore passage keeps no moat along its open run either.
            .chain(shore_gaps.iter().flat_map(|&(a, l)| {
                let n = (l / 8.0).ceil().max(1.0) as usize;
                (0..n).map(move |i| (a + l * i as f64 / n as f64, a + l * (i + 1) as f64 / n as f64)).collect::<Vec<_>>()
            }).map(|(s0, s1)| {
                let (p0, k) = walk.along(s0); let (p1, _) = walk.along(s1); let t = dir(p0, p1);
                let wd = face + berm + dw + 30.0;
                quad(p0, t, ns[k], [0.0, dist(p0, p1)], [-wd, wd])
            }))
            .collect(),
    );
    if let Some(kind) = ditch_kind {
        let inner_ring = buffer_all(&moat_core, berm);
        let outer_ring = buffer_all(&moat_core, berm + dw);
        // The berm between the curtain (or its outworks) and the ditch is
        // part of the fortification: no quarter keeps a sliver there.
        let berm_land: Vec<Shape> = inner_ring
            .iter()
            .flat_map(|o| g::difference(o, poly))
            .collect();
        extra_reserve.extend(
            clear
                .from(no_ditch.from(tiles(berm_land, TILE)))
                .into_iter()
                .filter(|s| !severed(s, path, street_lines)),
        );
        let mut band: Vec<Shape> = outer_ring
            .iter()
            .flat_map(|o| {
                inner_ring.iter().fold(vec![o.clone()], |acc, i| {
                    acc.iter().flat_map(|p| g::difference(p, i)).collect()
                })
            })
            .collect();
        band.extend(ravelin_ditch.iter().cloned());
        let band = tiles(g::union(&band), TILE);
        let band = Cut::new(ravelin_cut.clone()).from(band);
        // Test separation locally: one access road cannot discard a whole
        // connected moat because its representative point lies beyond it.
        let band = clear.from(no_ditch.from(inner_core.from(band)));
        let band = tiles(band, 24.0).into_iter()
            .filter(|d| !severed(d, path, street_lines)).collect::<Vec<_>>();
        let band = g::union(&band);
        let band = if style.ditch_wetness.is_some() || (style.dry_ditches && style.ditch == "auto") { tiles(band, 24.0) } else { band };
        // A moat hook left round the tip of a stretch inside a shore passage
        // guards no curtain: it goes with the stretch.
        let off_gap = |d: &Shape| { let s = walk.arc(g::interior_point(d));
            !shore_gaps.iter().any(|&(a, l)| { let t = (s - a).rem_euclid(walk.total); t > 8.0 && t < l - 8.0 }) };
        // A circuit crossing a river to wall a small salient of the far bank
        // (under a quarter of its largest dry land) digs no moat there: the
        // river is its ditch, and a stub of ditch among the houses is a relic.
        let lands = g::dry_clip(&surface, poly);
        let big = lands.iter().map(|l| g::area(l)).fold(0.0_f64, f64::max);
        let salients: Vec<&Shape> = if lands.len() > 1 { lands.iter().filter(|l| g::area(l) < 0.25 * big).collect() } else { vec![] };
        let near_ring = |c: Point, s: &Shape| {
            let n = s.outer.len();
            (0..n).any(|i| g::distance(c, s.outer[i], s.outer[(i + 1) % n]).0 < 3.0)
        };
        let far_bank = |d: &Shape| {
            if salients.is_empty() { return false; }
            let p = g::interior_point(d);
            let Some((_, _, c)) = path.windows(2).map(|w| g::distance(p, w[0], w[1]))
                .min_by(|x, y| x.0.total_cmp(&y.0)) else { return false };
            salients.iter().any(|s| near_ring(c, s)) && !lands.iter().filter(|l| g::area(l) >= 0.25 * big).any(|l| near_ring(c, l))
        };
        ditch.extend(par::map(&band, |_, p| {
            g::dry_clip(&surface, p).into_iter()
                .filter(|d| g::area(d) > 20.0 && off_gap(d) && !far_bank(d))
                .map(|shape| Work {
                    kind: if let Some(wetness) = style.ditch_wetness {
                        parameters::ditch_kind(&shape, surface, rng, wetness).into()
                    } else if style.dry_ditches && style.ditch == "auto" {
                        options::ditch_kind(&shape, surface, rng).into()
                    } else { kind.into() },
                    shape,
                    height_m: depth,
                    passage: None,
                })
                .collect::<Vec<_>>()
        }).into_iter().flatten());
        if ctx.has("glacis") {
            let far = buffer_all(&moat_core, berm + dw + 20.0);
            let band: Vec<Shape> = far
                .iter()
                .flat_map(|o| {
                    outer_ring.iter().fold(vec![o.clone()], |acc, i| {
                        acc.iter().flat_map(|p| g::difference(p, i)).collect()
                    })
                })
                .collect();
            let band = Cut::new(ravelin_cut.iter().chain(&ravelin_ditch).cloned().collect())
                .from(tiles(band, TILE));
            for p in g::union(&clear.from(no_ditch.from(band))) {
                glacis.extend(
                    g::dry_clip(&surface, &p)
                        .into_iter()
                        .filter(|d| g::area(d) > 20.0 && !severed(d, path, street_lines)),
                );
            }
        }
    }
    for p in glacis {
        outworks.push(Work {
            kind: "glacis".into(),
            shape: p,
            height_m: 0.0,
            passage: None,
        });
    }
    ditch
}

/// A berm, ditch or glacis piece that a street separates from the curtain:
/// the way from inside it to the nearest curtain point crosses a street centre
/// line. The fortification stops at that street (a street running along the
/// ditch has filled it); the land beyond belongs to the town, so no sliver of
/// ditch is left on the town side of the street to bite into its lots.
fn severed(piece: &Shape, path: &[Point], streets: &[(Point, Point)]) -> bool {
    let p = g::interior_point(piece);
    let Some((_, _, c)) = path
        .windows(2)
        .map(|w| g::distance(p, w[0], w[1]))
        .min_by(|a, b| a.0.total_cmp(&b.0))
    else {
        return false;
    };
    streets
        .iter()
        .any(|&(a, b)| g::segment_hit(p, c, a, b).is_some())
}
/// Depths (m) beyond a moat's outer edge at which the town is looked for.
const EMBED_DEPTHS: [f64; 4] = [10.0, 30.0, 60.0, 100.0];
/// A moat with built blocks beyond it at every depth on three quarters of its
/// outer edge lies inside the town (an older circuit, a curtain in a river
/// loop the faubourg has grown round), not outside the curtain it guards.
pub(super) fn embedded(piece: &Shape, path: &[Point], built: &[(Box2, &Shape)]) -> bool {
    let ring = &piece.outer;
    let n = ring.len();
    let mut samples = vec![];
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let k = (dist(a, b) / 4.0).ceil().max(1.0) as usize;
        samples.extend((0..k).map(|j| add(a, dir(a, b), dist(a, b) * j as f64 / k as f64)));
    }
    let near: Vec<(Point, f64, Point)> = samples.iter().filter_map(|&p| {
        let (d, _, c) = path.windows(2).map(|w| g::distance(p, w[0], w[1])).min_by(|x, y| x.0.total_cmp(&y.0))?;
        Some((p, d, c))
    }).collect();
    let (lo, hi) = near.iter().fold((f64::MAX, 0.0_f64), |(l, h), x| (l.min(x.1), h.max(x.1)));
    // The outer half of the piece: its edge away from the curtain.
    let outer: Vec<_> = near.into_iter().filter(|x| x.1 >= 0.5 * (lo + hi) && x.1 > 1e-6).collect();
    if outer.len() < 4 { return false; }
    let inside = |q: Point| built.iter().any(|(b, s)| q.x >= b.0 && q.x <= b.2 && q.y >= b.1 && q.y <= b.3 && g::contains(s, q));
    let hits: usize = outer.iter().map(|&(p, d, c)| {
        let u = ((p.x - c.x) / d, (p.y - c.y) / d);
        EMBED_DEPTHS.iter().filter(|&&k| inside(add(p, u, k))).count()
    }).sum();
    hits as f64 >= 0.75 * (outer.len() * EMBED_DEPTHS.len()) as f64
}

/// Shortest moat run kept (m along the curtain, half the piece's perimeter):
/// a shorter piece left between two causeways, a street or a slope is a relic
/// stub, not a moat.
const MIN_MOAT_RUN: f64 = 30.0;
/// A circuit whose moat runs cover less than this share of its dry curtain
/// digs none: a moat is a ring, or nothing, never a few scattered pieces.
const MIN_MOAT_SHARE: f64 = 0.35;
/// Invariant (a moat is continuous or absent): pieces shorter than
/// `MIN_MOAT_RUN` go, and the whole moat goes when what is left covers less
/// than `MIN_MOAT_SHARE` of the dry length of the curtain.
pub(super) fn continuous_moat(ditch: Vec<Work>, path: &[Point], surface: Surface<'_>) -> Vec<Work> {
    if ditch.is_empty() {
        return ditch;
    }
    let run = |s: &Shape| {
        let n = s.outer.len();
        (0..n).map(|i| dist(s.outer[i], s.outer[(i + 1) % n])).sum::<f64>() * 0.5
    };
    // Runs are measured on the joined moat (tiles of one run count together).
    let parts = g::union(&ditch.iter().map(|d| d.shape.clone()).collect::<Vec<_>>());
    let runs: Vec<f64> = parts.iter().map(|s| run(s)).collect();
    let kept: Vec<Work> = ditch
        .into_iter()
        .filter(|d| {
            let p = g::interior_point(&d.shape);
            parts.iter().zip(&runs).any(|(s, &r)| r >= MIN_MOAT_RUN && g::contains(s, p))
        })
        .collect();
    let dry: f64 = path
        .windows(2)
        .map(|w| {
            let l = dist(w[0], w[1]);
            let k = (l / 8.0).ceil().max(1.0) as usize;
            let wet = (0..k)
                .filter(|&j| surface.wet(add(w[0], dir(w[0], w[1]), l * (j as f64 + 0.5) / k as f64)))
                .count();
            l * (1.0 - wet as f64 / k as f64)
        })
        .sum();
    let covered: f64 = runs.iter().filter(|&&r| r >= MIN_MOAT_RUN).sum();
    if covered < MIN_MOAT_SHARE * dry { vec![] } else { kept }
}
