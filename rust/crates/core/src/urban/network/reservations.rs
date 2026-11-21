//! Carry reserved block frontage across edits that renumber streets.

use super::spatial::{BoxGrid, EPS, distance, segment_box};
use crate::urban::{Layout, Point, Street};

/// The streets serving reserved blocks, to carry across a pass that renumbers streets.
pub(in crate::urban) fn reserved_streets(layout: &Layout) -> Vec<Option<Street>> {
    layout.programme.iter().flat_map(|p| &p.reservations).map(|r| layout.streets.get(r.street).cloned()).collect()
}
pub(in crate::urban) fn remap_reservations(layout: &mut Layout, reserved: &[Option<Street>]) {
    // Junction insertion and rejected decks change street indices, not the
    // road serving an already reserved block. Carry those witnesses forward.
    // A segment of a land street shares a segment of the old street when both
    // its ends lie on it; the segments are found through a grid, then the
    // overlap of each street is summed in segment order.
    if reserved.iter().all(Option::is_none) { return; }
    let mut owners: Vec<(usize, usize)> = vec![];
    let mut ends: Vec<(Point, Point)> = vec![];
    for (i, s) in layout.streets.iter().enumerate().filter(|(_, s)| s.role != "bridge") {
        for (k, w) in s.path.windows(2).enumerate() { owners.push((i, k)); ends.push((w[0], w[1])); }
    }
    let grid = BoxGrid::new(&ends.iter().map(|&(a, b)| segment_box(a, b, 0.0)).collect::<Vec<_>>(), 32.0);
    let remap: Vec<_> = reserved.iter().map(|old| old.as_ref().and_then(|old| {
        let mut shared: Vec<usize> = vec![];
        for v in old.path.windows(2) {
            let (x0, y0, x1, y1) = segment_box(v[0], v[1], 0.02);
            for k in grid.query(x0, y0, x1, y1) {
                let (a, b) = ends[k];
                if crate::urban::geometry::distance(a, v[0], v[1]).0 < 0.01 && crate::urban::geometry::distance(b, v[0], v[1]).0 < 0.01 { shared.push(k); }
            }
        }
        shared.sort_unstable();
        shared.dedup();
        let mut best: Option<(usize, f64)> = None;
        let mut n = 0;
        while n < shared.len() {
            let street = owners[shared[n]].0;
            let mut overlap = 0.0;
            while n < shared.len() && owners[shared[n]].0 == street {
                let (a, b) = ends[shared[n]];
                overlap += distance(a, b);
                n += 1;
            }
            // The longest overlap wins, the lowest street index on a tie.
            if overlap > EPS && best.is_none_or(|(_, o)| overlap.total_cmp(&o).is_gt()) { best = Some((street, overlap)); }
        }
        best.map(|v| v.0)
    })).collect();
    if let Some(p) = &mut layout.programme {
        for (r, i) in p.reservations.iter_mut().zip(remap) { if let Some(i) = i { r.street = i; } }
    }
}
