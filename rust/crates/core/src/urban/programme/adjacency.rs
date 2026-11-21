//! Parcel neighbours from positive shared boundary, in deterministic edge order.

use crate::urban::{Partition, Point, Shape};

use super::{Adjacency, dist};

/// Positive collinear overlap gives real edge adjacency, never centroid proximity.
pub(super) fn shared(a: &Shape, b: &Shape) -> f64 {
    let mut sum = 0.0;
    for (&u, &v) in std::iter::once(&a.outer)
        .chain(a.holes.iter())
        .flat_map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
        })
    {
        let len = dist(u, v);
        if len < 0.01 {
            continue;
        }
        for (&p, &q) in std::iter::once(&b.outer)
            .chain(b.holes.iter())
            .flat_map(|ring| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
            })
        {
            let cross =
                |x: Point| ((x.x - u.x) * (v.y - u.y) - (x.y - u.y) * (v.x - u.x)).abs() / len;
            if cross(p) > 0.02 || cross(q) > 0.02 {
                continue;
            }
            let t = |x: Point| ((x.x - u.x) * (v.x - u.x) + (x.y - u.y) * (v.y - u.y)) / len;
            let (lo, hi) = (t(p).min(t(q)), t(p).max(t(q)));
            sum += (hi.min(len) - lo.max(0.0)).max(0.0);
        }
    }
    sum
}
pub(super) fn graph(partition: &Partition) -> (Vec<Adjacency>, Vec<Vec<usize>>) {
    // Parcels are binned on a 64 m grid, one entry per (cell, parcel). Sorted
    // by (cell, parcel index), the entries give the cells in (x, y) order and
    // the parcels of one cell in index order.
    let mut entries: Vec<(i32, i32, usize)> = vec![];
    let mut boxes = Vec::with_capacity(partition.parcels.len());
    // Cell range of each box: ((first x, last x), (first y, last y)).
    let mut spans: Vec<((i32, i32), (i32, i32))> = Vec::with_capacity(partition.parcels.len());
    for (i, p) in partition.parcels.iter().enumerate() {
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &p.shape.outer {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        }
        boxes.push((x0, y0, x1, y1));
        let xs = (((x0 - 0.03) / 64.0).floor() as i32, ((x1 + 0.03) / 64.0).floor() as i32);
        let ys = (((y0 - 0.03) / 64.0).floor() as i32, ((y1 + 0.03) / 64.0).floor() as i32);
        spans.push((xs, ys));
        for x in xs.0..=xs.1 {
            for y in ys.0..=ys.1 {
                entries.push((x, y, i));
            }
        }
    }
    entries.sort_unstable();
    // The cells, as ranges of `entries`, in (x, y) order.
    let mut cells: Vec<(usize, usize)> = vec![];
    let mut start = 0;
    while start < entries.len() {
        let (cx, cy, _) = entries[start];
        let mut end = start + 1;
        while end < entries.len() && entries[end].0 == cx && entries[end].1 == cy {
            end += 1;
        }
        cells.push((start, end));
        start = end;
    }
    // Each cell tests its own pairs (pure), in parallel; the pairs are then
    // recorded in cell order, as a serial scan would.
    let found = crate::urban::par::map(&cells, |_, &(start, end)| {
        let ids = &entries[start..end];
        let (cx, cy, _) = entries[start];
        let mut pairs: Vec<(usize, usize, f64)> = vec![];
        for (at, &(_, _, a)) in ids.iter().enumerate() {
            for &(_, _, b) in &ids[at + 1..] {
                // Disjoint boxes cannot share an edge: skip the exact test.
                let (p, q) = (boxes[a], boxes[b]);
                if p.0 > q.2 + 0.05 || q.0 > p.2 + 0.05 || p.1 > q.3 + 0.05 || q.1 > p.3 + 0.05 {
                    continue;
                }
                // A pair is tested once, in the first cell (x, y order) that
                // both boxes cover: the lowest corner of their common cells.
                let (sa, sb) = (spans[a], spans[b]);
                if (cx, cy) != (sa.0.0.max(sb.0.0), sa.1.0.max(sb.1.0)) {
                    continue;
                }
                let length = shared(&partition.parcels[a].shape, &partition.parcels[b].shape);
                if length > 0.1 {
                    pairs.push((a, b, length));
                }
            }
        }
        pairs
    });
    let mut edges = vec![];
    let mut neighbours = vec![vec![]; partition.parcels.len()];
    for (a, b, length) in found.into_iter().flatten() {
        neighbours[a].push(b);
        neighbours[b].push(a);
        edges.push(Adjacency {
            a: partition.parcels[a].id.clone(),
            b: partition.parcels[b].id.clone(),
            shared_length: length,
        });
    }
    (edges, neighbours)
}
