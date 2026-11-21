//! Frontage depth measurement and rear-land cuts.

use super::contacts;
use super::contacts::{Front, frontage};
use super::cut_geometry::{bounds, dot, frame_direction, half, length, normal, sub, unit};
use super::identity::parcel;
use crate::urban::{Morph, Parcel, Point, Shape};

/// The culture's deepest ordinary lot: its catalogue plot depth, or the side of
/// a square lot of its largest house area when that is deeper (courtyard
/// cultures). Land behind stays garden or field; deep blocks keep a back seam
/// of gardens instead of 300 m strips (TODO bug 2b).
pub(super) fn maximum_plot_depth(morph: &Morph, zone: &str) -> f64 {
    let [a, b] = morph.range("plotDepth", zone);
    let house = morph.range("houseArea", zone)[1].max(0.0).sqrt();
    b.max(a).max(house).max(1.0)
}

pub(super) fn plot_depth(shape: &Shape, axis: Point, fronts: &[Front]) -> Option<f64> {
    let f = frontage(shape, fronts).1?;
    let inward = frame_direction(normal(unit(sub(f.b, f.a))), axis);
    Some(bounds(shape, inward).1 - dot(f.a, inward).min(dot(f.b, inward)))
}

/// Depth of a lot from its best real access: over every contact of at least
/// 3 m (any contact otherwise), the smallest reach of the lot behind its line.
pub(super) fn lot_depth(shape: &Shape, fronts: &[Front]) -> f64 {
    let contacts = contacts::boundary_contacts(shape, fronts);
    let long = contacts.iter().any(|f| length(sub(f.b, f.a)) >= 3.0);
    contacts
        .iter()
        .filter(|f| !long || length(sub(f.b, f.a)) >= 3.0)
        .map(|f| {
            let n = normal(unit(sub(f.b, f.a)));
            shape
                .outer
                .iter()
                .map(|p| dot(sub(*p, f.a), n))
                .fold(0.0, f64::max)
        })
        .fold(f64::INFINITY, f64::min)
        .min(1e9)
}

pub(super) fn bound_frontage_depth(p: Parcel, limit: f64) -> Vec<Parcel> {
    let Some([a, b]) = p.front.filter(|_| p.use_kind == "plot") else {
        return vec![p];
    };
    let inward = normal(unit(sub(b, a)));
    let base = dot(a, inward);
    let (lo, hi) = bounds(&p.shape, inward);
    if lo >= base - limit - 0.01 && hi <= base + limit + 0.01 {
        return vec![p];
    }
    // Concave territories may wrap behind the selected frontage. Bound both
    // sides of that frontage, and keep it authoritative after the cut rather
    // than silently selecting a different street on the new polygon.
    let front = [Front {
        a,
        b,
        rank: p.rank,
        street: p.access.as_ref().and_then(|a| a.street).unwrap_or(0),
        shared: p.access.as_ref().is_some_and(|a| a.kind == "collective"),
        gate: p
            .access
            .as_ref()
            .is_some_and(|a| matches!(a.kind.as_str(), "private" | "collective")),
    }];
    let mut out = vec![];
    let near = half(&p.shape, inward, base - limit, false);
    for rear in half(&p.shape, inward, base - limit, true) {
        out.push(parcel(rear, p.block, p.axis, &[], "garden"));
    }
    for cell in near {
        for rear in half(&cell, inward, base + limit, false) {
            out.push(parcel(rear, p.block, p.axis, &[], "garden"));
        }
        for built in half(&cell, inward, base + limit, true) {
            out.push(parcel(built, p.block, p.axis, &front, "plot"));
        }
    }
    for child in &mut out {
        child.parent_ids = vec![p.id.clone()];
        child.provenance = p.provenance.clone();
        child.provenance.push("depth-bound".into());
    }
    out
}
