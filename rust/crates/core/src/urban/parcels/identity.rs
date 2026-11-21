//! Lot construction and geometric identity from birth through publication.

use super::contacts::{Front, frontage};
use super::cut_geometry::{dot, length, sub, unit};
use crate::urban::{Layout, Parcel, Point, Shape};

pub(super) fn parcel(shape: Shape, block: usize, axis: Point, fronts: &[Front], kind: &str) -> Parcel {
    let (len, f) = frontage(&shape, fronts);
    let id = identity(&shape, block);
    Parcel {
        id,
        pressure: 0.0,
        envelope: None,
        parent_ids: vec![format!("block-{block}")],
        provenance: vec![
            if kind == "garden" {
                "retained-backland"
            } else {
                "frontage-partition"
            }
            .into(),
        ],
        family: String::new(),
        reason: if kind == "garden" {
            "retained-backland"
        } else if len < 3.0 {
            "insufficient-frontage"
        } else {
            "frontage-qualified"
        }
        .into(),
        contacts: Vec::new(),
        shape,
        block,
        axis,
        use_kind: kind.to_owned(),
        front: f.filter(|_| len > 0.01).map(|f| [f.a, f.b]),
        rank: f.map_or(99, |f| f.rank),
        access: Some(crate::urban::ParcelAccess {
            kind: if len <= 0.01 {
                "unserved"
            } else if f.is_some_and(|f| f.shared) {
                "collective"
            } else {
                "public"
            }
            .into(),
            street: f.filter(|_| len > 0.01).map(|f| f.street),
            front_length: len,
        }),
    }
}

/// Geometry identity ignores ring start, winding and redundant collinear points.
/// Coordinates are rounded to 0.1mm only for the ID, never for geometry.
pub(super) fn identity(shape: &Shape, block: usize) -> String {
    let mut rings = Vec::new();
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        let mut points = ring.clone();
        loop {
            let n = points.len();
            let keep: Vec<_> = (0..n)
                .filter(|&i| {
                    let a = sub(points[i], points[(i + n - 1) % n]);
                    let b = sub(points[(i + 1) % n], points[i]);
                    length(a) > 1e-8 && length(b) > 1e-8 && dot(unit(a), unit(b)) < 1.0 - 1e-10
                })
                .map(|i| points[i])
                .collect();
            if keep.len() == n || keep.len() < 3 {
                break;
            }
            points = keep;
        }
        let mut quantized: Vec<_> = points
            .iter()
            .map(|p| {
                (
                    (p.x * 10000.0).round() as i64,
                    (p.y * 10000.0).round() as i64,
                )
            })
            .collect();
        // Canonical cyclic order preserves edge topology while ignoring ring
        // start/winding; sorting vertices would conflate distinct concavities.
        if let Some(first) = quantized.iter().min().copied() {
            let n = quantized.len();
            let canonical = (0..n)
                .filter(|&i| quantized[i] == first)
                .flat_map(|i| {
                    [
                        (0..n).map(|j| quantized[(i + j) % n]).collect::<Vec<_>>(),
                        (0..n)
                            .map(|j| quantized[(i + n - j) % n])
                            .collect::<Vec<_>>(),
                    ]
                })
                .min()
                .unwrap();
            rings.push(canonical);
        } else {
            rings.push(std::mem::take(&mut quantized));
        }
    }
    rings.sort();
    let mut hash = 0xcbf29ce484222325u64;
    for ring in rings {
        for (x, y) in ring {
            for byte in x.to_le_bytes().into_iter().chain(y.to_le_bytes()) {
                hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3);
            }
        }
        hash = (hash ^ 255).wrapping_mul(0x100000001b3);
    }
    format!("block-{block}/{hash:016x}")
}

pub(super) fn block_identity(layout: &Layout, shape: &Shape) -> String {
    let mut key = 0xcbf29ce484222325u64;
    for byte in layout.key.bytes() {
        key = (key ^ byte as u64).wrapping_mul(0x100000001b3);
    }
    let geometry = identity(shape, 0);
    format!(
        "layout-{key:016x}/block-{}",
        geometry.split_once('/').unwrap().1
    )
}
/// Operator-local lineage tokens are resolved to their retained owner before
/// export. Array position remains solely the p.block lookup, never identity.
pub(super) fn resolve_identity(parcel: &mut Parcel, block: usize, owner: &str) {
    let root = format!("block-{block}");
    let map = |id: &str| {
        if id == root {
            owner.to_owned()
        } else if let Some(hash) = id.strip_prefix(&format!("{root}/")) {
            format!("{owner}/parcel-{hash}")
        } else {
            id.to_owned()
        }
    };
    parcel.id = map(&parcel.id);
    parcel.parent_ids = parcel.parent_ids.iter().map(|id| map(id)).collect();
}

pub(super) fn disambiguate(parcels: &mut [Parcel], bi: usize) {
    // An id is minted from a parcel's geometry at its birth and kept while
    // tidying reshapes it, so a later cut (an arm garden) can reproduce an
    // earlier parcel's birth shape and its id. Twins re-key from their
    // current geometry; exact geometric twins take an ordinal.
    let mut count = std::collections::HashMap::<String, usize>::new();
    for p in parcels.iter() {
        *count.entry(p.id.clone()).or_default() += 1;
    }
    if count.values().any(|&n| n > 1) {
        for p in parcels.iter_mut().filter(|p| count[&p.id] > 1) {
            p.id = identity(&p.shape, bi);
        }
        let mut seen = std::collections::HashMap::<String, usize>::new();
        for p in parcels.iter_mut() {
            let n = seen.entry(p.id.clone()).or_default();
            *n += 1;
            if *n > 1 {
                p.id = format!("{}-{}", p.id, *n - 1);
            }
        }
    }
}
