//! Gridding of unserved fields and retention of gardens behind lots.

use super::contacts;
use super::contacts::{Front, access_kind};
use super::cut_geometry::{add, dot, length, normal, scale, sub, unit};
use super::depth::bound_frontage_depth;
use crate::urban::{Layout, Parcel, Point, Shape};
use crate::urban::geometry::{area, intersection};

/// Field plots: the shape cut by a grid of `w` × `d` m cells along `axis`.
pub(super) fn field_grid(shape: &Shape, axis: Point, w: f64, d: f64) -> Vec<Shape> {
    let l = length(axis).max(1e-9);
    let u = Point { x: axis.x / l, y: axis.y / l };
    let v = Point { x: -u.y, y: u.x };
    let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in &shape.outer {
        let (s, t) = (dot(*p, u), dot(*p, v));
        s0 = s0.min(s);
        s1 = s1.max(s);
        t0 = t0.min(t);
        t1 = t1.max(t);
    }
    let (ns, nt) = (((s1 - s0) / w).round().max(1.0), ((t1 - t0) / d).round().max(1.0));
    let (ws, dt) = ((s1 - s0) / ns, (t1 - t0) / nt);
    let at = |s: f64, t: f64| add(scale(u, s), scale(v, t));
    let mut out = vec![];
    for i in 0..ns as usize {
        for j in 0..nt as usize {
            let (a0, a1) = (s0 + i as f64 * ws, s0 + (i + 1) as f64 * ws);
            let (b0, b1) = (t0 + j as f64 * dt, t0 + (j + 1) as f64 * dt);
            let cell = Shape { outer: vec![at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)], holes: vec![] };
            out.extend(intersection(&cell, shape).into_iter().filter(|c| area(c) > 1.0));
        }
    }
    out
}

/// Share of a culture's own open land that an adapted tissue keeps in every
/// block: its lot gardens as drawn (`CapacityPlan.garden_share`) and, off the
/// core, the fringe fields the plan gave up. Densifying, borrowing a compact
/// cutting or filling the fringe may shrink yards, never erase them.
pub(super) const GARDEN_FLOOR: f64 = 0.5;

/// Invariant (garden character): when the capacity plan adapted the tissue,
/// at least `floor` of the block stays garden. Admitted lots, deepest first,
/// give up their rear beyond their own witness (envelope + 2 m, never under
/// `keep`), uniformly in proportion, as gardens attached to the lot. The
/// witness stays inside the lot, so no lot loses its admission.
pub(super) fn keep_gardens(cells: &mut Vec<Parcel>, fronts: &[Front], layout: &Layout, floor: f64, keep: f64) {
    let block: f64 = cells.iter().map(|p| area(&p.shape)).sum();
    let gardens: f64 = cells
        .iter()
        .filter(|p| p.use_kind == "garden")
        .map(|p| area(&p.shape))
        .sum();
    let deficit = floor * block - gardens;
    if deficit <= 1.0 {
        return;
    }
    // Rear land each admitted lot can give: beyond its witness depth.
    let spare: Vec<Option<(f64, f64, f64)>> = cells
        .iter()
        .map(|p| {
            let ([a, b], envelope) = (p.front?, p.envelope.as_ref()?);
            if p.use_kind != "plot" {
                return None;
            }
            let n = normal(unit(sub(b, a)));
            let base = dot(a, n);
            let reach = |s: &Shape| {
                s.outer
                    .iter()
                    .map(|v| (dot(*v, n) - base).abs())
                    .fold(0.0, f64::max)
            };
            let depth = reach(&p.shape);
            let minimum = (reach(envelope) + 2.0).max(keep);
            (depth > minimum + 1.0).then(|| {
                let width = area(&p.shape) / depth.max(1e-6);
                (depth, minimum, width * (depth - minimum))
            })
        })
        .collect();
    let available: f64 = spare.iter().flatten().map(|s| s.2).sum();
    if available <= 1.0 {
        return;
    }
    let r = (deficit / available).min(1.0);
    let mut out = Vec::with_capacity(cells.len());
    for (p, spare) in cells.drain(..).zip(spare) {
        let Some((depth, minimum, _)) = spare else {
            out.push(p);
            continue;
        };
        let limit = depth - r * (depth - minimum);
        let pieces = bound_frontage_depth(p.clone(), limit);
        let Some(built) = pieces.iter().find(|q| q.use_kind == "plot") else {
            out.push(p);
            continue;
        };
        let envelope = p.envelope.clone().unwrap();
        if pieces.iter().filter(|q| q.use_kind == "plot").count() != 1
            || crate::urban::geometry::difference(&envelope, &built.shape)
                .iter()
                .map(area)
                .sum::<f64>()
                > 1e-6
        {
            out.push(p);
            continue;
        }
        for mut q in pieces {
            q.family = p.family.clone();
            q.pressure = p.pressure;
            q.provenance.push("garden-floor".into());
            if q.use_kind == "plot" {
                q.reason = p.reason.clone();
                q.envelope = Some(envelope.clone());
                q.front = p.front;
                q.rank = p.rank;
                q.access = p.access.clone();
                q.contacts = contacts::boundary_contacts(&q.shape, fronts)
                    .iter()
                    .map(|f| crate::urban::ParcelContact {
                        a: f.a,
                        b: f.b,
                        street: f.street,
                        rank: f.rank,
                        length: length(sub(f.b, f.a)),
                        kind: access_kind(f, layout).into(),
                    })
                    .collect();
            } else {
                q.reason = "attached-rear-land".into();
                q.parent_ids = vec![p.id.clone()];
                q.access = Some(crate::urban::ParcelAccess {
                    kind: "attached".into(),
                    street: p.access.as_ref().and_then(|a| a.street),
                    front_length: 0.0,
                });
            }
            out.push(q);
        }
    }
    *cells = out;
}
