//! Reading curtain faces and cutting lean-to lots along the town wall.

use super::contacts::{Front, access_kind};
use super::cut_geometry::{add, distance, length, scale, sub, unit};
use super::identity::{block_identity, parcel, resolve_identity};
use crate::urban::{Layout, Morph, Parcel, Point, Shape};
use crate::urban::geometry::{area, intersection};

/// Stretches of a block's outline that lie on the inner face of a town wall
/// (within 0.35 m of offset `-ribbon_half` from the curtain path, on its inner
/// side). Palisades, hedges and earthworks are not party walls.
pub(super) fn wall_faces(shape: &Shape, layout: &Layout) -> Vec<(Point, Point)> {
    let mut out = Vec::new();
    let (x0, y0, x1, y1) = crate::urban::geometry::bbox(shape);
    for e in layout
        .enclosures
        .iter()
        .filter(|e| e.kind == "wall" && e.path.len() >= 3)
    {
        let h = crate::urban::fortification::ribbon_half(&e.kind);
        let near: Vec<(Point, Point)> = (0..e.path.len())
            .map(|i| (e.path[i], e.path[(i + 1) % e.path.len()]))
            .filter(|(a, b)| {
                a.x.min(b.x) <= x1 + h + 1.0
                    && a.x.max(b.x) >= x0 - h - 1.0
                    && a.y.min(b.y) <= y1 + h + 1.0
                    && a.y.max(b.y) >= y0 - h - 1.0
            })
            .collect();
        if near.is_empty() {
            continue;
        }
        let wall = Shape {
            outer: e.path.clone(),
            holes: vec![],
        };
        let on_face = |p: Point| {
            let d = near
                .iter()
                .map(|&(a, b)| distance(p, a, b))
                .fold(f64::INFINITY, f64::min);
            (d - h).abs() <= 0.35
        };
        let ring = &shape.outer;
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            let m = scale(add(a, b), 0.5);
            if length(sub(b, a)) >= 0.5
                && on_face(a)
                && on_face(b)
                && on_face(m)
                && crate::urban::geometry::contains(&wall, m)
            {
                out.push((a, b));
            }
        }
    }
    out
}

/// Length of `shape`'s outline lying on the given wall faces.
pub(super) fn wall_contact(shape: &Shape, faces: &[(Point, Point)]) -> f64 {
    let ring = &shape.outer;
    (0..ring.len())
        .map(|i| (ring[i], ring[(i + 1) % ring.len()]))
        .filter(|&(a, b)| {
            let m = scale(add(a, b), 0.5);
            faces.iter().any(|&(p, q)| {
                distance(a, p, q) < 0.05 && distance(b, p, q) < 0.05 && distance(m, p, q) < 0.05
            })
        })
        .map(|(a, b)| length(sub(b, a)))
        .sum()
}

/// Wall faces carried by a block's morph (`_wallFace`, set by `generate`).
pub(super) fn morph_faces(morph: &Morph) -> Vec<(Point, Point)> {
    morph.value["_wallFace"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let v = v.as_array()?;
                    let n = |i: usize| v.get(i).and_then(|x| x.as_f64());
                    Some((Point { x: n(0)?, y: n(1)? }, Point { x: n(2)?, y: n(3)? }))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Invariant (faubourg against the wall): a lean-to the fortification drew
/// against the outer face of the curtain (`Enclosure.attached`, side `out`)
/// and left outside its `reserve` is a real lot: a plot of the outer block it
/// touches, fronting the gate road along its side within 2 m (its street
/// edge, at least 3 m long). A lean-to still inside the reserve, or with no
/// road beside it, stays decor; nothing is ever drawn in the ditch or glacis,
/// which the fortification never offers.
pub(super) fn lean_to_lots(layout: &Layout) -> Vec<Parcel> {
    // Each attached piece reads the whole network on its own: they are checked
    // in parallel and kept in enclosure order.
    let pieces: Vec<_> = layout.enclosures.iter().enumerate()
        .flat_map(|(ei, e)| e.attached.iter().enumerate().map(move |(ai, a)| (ei, ai, e, a)))
        .collect();
    crate::urban::par::map(&pieces, |_, &(ei, ai, e, a)| -> Option<Parcel> {
            if a.side != "out" || a.shape.outer.len() < 3 {
                return None;
            }
            let own = area(&a.shape);
            let reserved: f64 = e
                .reserve
                .iter()
                .flat_map(|r| intersection(&a.shape, r))
                .map(|x| area(&x))
                .sum();
            if own < 4.0 || reserved > 0.5 * own {
                return None;
            }
            let ring = &a.shape.outer;
            // The edge facing a road: nearest street ribbon within 2 m.
            let mut best: Option<(f64, Point, Point, usize)> = None;
            for i in 0..ring.len() {
                let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
                if length(sub(q, p)) < 3.0 {
                    continue;
                }
                let m = scale(add(p, q), 0.5);
                for (si, st) in layout.streets.iter().enumerate() {
                    for (j, w) in st.path.windows(2).enumerate() {
                        let half = 0.5 * st.widths.get(j).copied().unwrap_or(4.0);
                        let gap = distance(m, w[0], w[1]) - half;
                        if gap <= 2.0 && best.is_none_or(|b| gap < b.0) {
                            best = Some((gap, p, q, si));
                        }
                    }
                }
            }
            let Some((_, fa, fb, street)) = best else {
                return None;
            };
            let c = crate::urban::geometry::centroid(&a.shape);
            let Some(block) = layout
                .blocks
                .iter()
                .enumerate()
                .filter(|(_, b)| b.kind == "block")
                .map(|(i, b)| {
                    let r = &b.shape.outer;
                    let d = (0..r.len())
                        .map(|k| distance(c, r[k], r[(k + 1) % r.len()]))
                        .fold(f64::INFINITY, f64::min);
                    (i, d)
                })
                .min_by(|x, y| x.1.total_cmp(&y.1))
                .map(|(i, _)| i)
            else {
                return None;
            };
            let st = &layout.streets[street];
            let front = Front {
                a: fa,
                b: fb,
                rank: st.rank,
                street,
                shared: false,
                gate: false,
            };
            let mut lot = parcel(a.shape.clone(), block, unit(sub(fb, fa)), &[front], "plot");
            lot.family = "faubourg".into();
            lot.reason = "wall-lean-to".into();
            lot.provenance = vec![format!("lean-to:{ei}:{ai}")];
            lot.envelope = Some(a.shape.clone());
            lot.contacts = vec![crate::urban::ParcelContact {
                a: fa,
                b: fb,
                street,
                rank: st.rank,
                length: length(sub(fb, fa)),
                kind: access_kind(&front, layout).into(),
            }];
            resolve_identity(
                &mut lot,
                block,
                &block_identity(layout, &layout.blocks[block].shape),
            );
            Some(lot)
    })
    .into_iter()
    .flatten()
    .collect()
}
