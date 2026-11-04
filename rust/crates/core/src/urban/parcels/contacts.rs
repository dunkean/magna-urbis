//! Continuous boundary/street contacts. Intervals, not input vertices, carry
//! access. All tolerances are metres, independent of polyline segmentation.
use super::*;

/// Projected support on one local tangent. Only touching contacts of the same
/// street/class join; the complete support stays within 20 degrees of it.
pub(super) fn support_span(fronts: &[Front], anchor: usize) -> (f64, f64) {
    let f = fronts[anchor];
    let u = unit(sub(f.b, f.a));
    let compatible = |g: &Front| {
        g.street == f.street
            && g.rank == f.rank
            && g.gate == f.gate
            && g.shared == f.shared
            && dot(unit(sub(g.b, g.a)), u) >= 20.0_f64.to_radians().cos()
    };
    let mut selected = vec![false; fronts.len()];
    selected[anchor] = true;
    let mut queue = vec![anchor];
    let (mut lo, mut hi) = (0.0_f64, length(sub(f.b, f.a)));
    while let Some(i) = queue.pop() {
        let current = fronts[i];
        for (j, other) in fronts.iter().enumerate() {
            if selected[j] || !compatible(other) {
                continue;
            }
            // Numerical tolerance only: offset-corner gaps remain gaps.
            if length(sub(current.b, other.a)).min(length(sub(other.b, current.a))) > 1e-5 {
                continue;
            }
            selected[j] = true;
            queue.push(j);
            for p in [other.a, other.b] {
                let projected = dot(sub(p, f.a), u);
                lo = lo.min(projected);
                hi = hi.max(projected);
            }
        }
    }
    (lo, hi)
}

/// `support_span` of every contact. The touching contacts are found once, so a
/// chain of `k` contacts costs its own length per anchor, not `k` squared.
pub(super) fn support_spans(fronts: &[Front]) -> Vec<(f64, f64)> {
    let mut starts: Vec<usize> = (0..fronts.len()).collect();
    starts.sort_by(|&i, &j| fronts[i].a.x.total_cmp(&fronts[j].a.x).then(i.cmp(&j)));
    let mut links: Vec<Vec<usize>> = vec![Vec::new(); fronts.len()];
    for (i, f) in fronts.iter().enumerate() {
        let from = starts.partition_point(|&j| fronts[j].a.x < f.b.x - 1e-5);
        for &j in starts[from..]
            .iter()
            .take_while(|&&j| fronts[j].a.x <= f.b.x + 1e-5)
        {
            if j != i && length(sub(f.b, fronts[j].a)) <= 1e-5 {
                links[i].push(j);
                links[j].push(i);
            }
        }
    }
    (0..fronts.len())
        .map(|anchor| {
            let f = fronts[anchor];
            let u = unit(sub(f.b, f.a));
            let compatible = |g: &Front| {
                g.street == f.street
                    && g.rank == f.rank
                    && g.gate == f.gate
                    && g.shared == f.shared
                    && dot(unit(sub(g.b, g.a)), u) >= 20.0_f64.to_radians().cos()
            };
            let mut selected = vec![false; fronts.len()];
            selected[anchor] = true;
            let mut queue = vec![anchor];
            let (mut lo, mut hi) = (0.0_f64, length(sub(f.b, f.a)));
            while let Some(i) = queue.pop() {
                for &j in &links[i] {
                    if selected[j] || !compatible(&fronts[j]) {
                        continue;
                    }
                    selected[j] = true;
                    queue.push(j);
                    for p in [fronts[j].a, fronts[j].b] {
                        let projected = dot(sub(p, f.a), u);
                        lo = lo.min(projected);
                        hi = hi.max(projected);
                    }
                }
            }
            (lo, hi)
        })
        .collect()
}

fn clip(interval: &mut (f64, f64), a: f64, b: f64) -> bool {
    // a + b*t >= 0
    if b.abs() < 1e-12 {
        return a >= -1e-10;
    }
    let t = -a / b;
    if b > 0.0 {
        interval.0 = interval.0.max(t);
    } else {
        interval.1 = interval.1.min(t);
    }
    interval.1 - interval.0 > 1e-9
}

pub(super) fn merge(mut fronts: Vec<Front>) -> Vec<Front> {
    let mut out: Vec<Front> = Vec::new();
    for f in fronts.drain(..) {
        if let Some(last) = out.last_mut()
            && last.street == f.street
            && last.rank == f.rank
            && last.shared == f.shared
            && last.gate == f.gate
            && length(sub(last.b, f.a)) < 1e-6
            && dot(unit(sub(last.b, last.a)), unit(sub(f.b, f.a))) > 1.0 - 1e-10
        {
            last.b = f.b;
        } else {
            out.push(f);
        }
    }
    if out.len() > 1 {
        let first = out[0];
        let last = *out.last().unwrap();
        if first.street == last.street
            && first.rank == last.rank
            && first.shared == last.shared
            && first.gate == last.gate
            && length(sub(last.b, first.a)) < 1e-6
            && dot(unit(sub(last.b, last.a)), unit(sub(first.b, first.a))) > 1.0 - 1e-10
        {
            out[0].a = last.a;
            out.pop();
        }
    }
    out
}

pub(super) fn street_contacts(shape: &Shape, layout: &Layout, index: &FrontageIndex) -> Vec<Front> {
    let mut result = Vec::new();
    let mut candidates = Vec::new();
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        let mut ring_contacts = Vec::new();
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let edge = sub(b, a);
            if length(edge) < 1e-7 {
                continue;
            }
            let inward = normal(unit(edge));
            index.candidates(a, b, &mut candidates);
            let mut intervals = Vec::new();
            for &(si, k) in &candidates {
                let street = &layout.streets[si];
                let p = street.path[k];
                let d = sub(street.path[k + 1], p);
                if length(d) < 1e-7 || dot(unit(d), unit(edge)).abs() < 20.0_f64.to_radians().cos()
                {
                    continue;
                }
                let u0 = dot(sub(a, p), d) / dot(d, d);
                let du = dot(edge, d) / dot(d, d);
                let outside0 = sub(add(p, scale(d, u0)), a);
                let outside_delta = sub(scale(d, du), edge);
                let h0 = -dot(outside0, inward);
                let dh = -dot(outside_delta, inward);
                let w0 = street.widths.get(k).copied().unwrap_or(4.0) * 0.5;
                let dw = street.widths.get(k + 1).copied().unwrap_or(4.0) * 0.5 - w0;
                let width0 = w0 + dw * u0;
                let width_delta = dw * du;
                // Union of the absolute (0.8m) and proportional (30%) bands.
                // Each is linear, including tapered streets.
                for proportional in [false, true] {
                    let (tol0, dtol) = if proportional {
                        (width0 * 0.3, width_delta * 0.3)
                    } else {
                        (0.8, 0.0)
                    };
                    let mut span = (0.0_f64, 1.0_f64);
                    if [
                        (u0, du),
                        (1.0 - u0, -du),
                        (h0 + 0.15, dh),
                        (14.0 - h0, -dh),
                        (tol0 - h0 + width0, dtol - dh + width_delta),
                        (tol0 + h0 - width0, dtol + dh - width_delta),
                    ]
                    .into_iter()
                    .all(|(c, d)| clip(&mut span, c, d))
                    {
                        intervals.push((span.0, span.1, street.rank, si));
                    }
                }
            }
            let mut breaks = intervals
                .iter()
                .flat_map(|&(lo, hi, _, _)| [lo, hi])
                .collect::<Vec<_>>();
            breaks.sort_by(f64::total_cmp);
            breaks.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            for pair in breaks.windows(2) {
                let mid = (pair[0] + pair[1]) * 0.5;
                if let Some(&(_, _, rank, street)) = intervals
                    .iter()
                    .filter(|&&(lo, hi, _, _)| mid >= lo && mid <= hi)
                    .min_by_key(|&&(_, _, rank, street)| (rank, street))
                {
                    ring_contacts.push(Front {
                        a: add(a, scale(edge, pair[0])),
                        b: add(a, scale(edge, pair[1])),
                        rank,
                        street,
                        shared: false,
                        gate: matches!(
                            layout.streets[street].role.as_str(),
                            "private" | "derb" | "hutong" | "roji" | "collective" | "close"
                        ),
                    });
                }
            }
        }
        result.extend(merge(ring_contacts));
    }
    result
}

/// Intersect both boundary interval sets, allowing either side to be split.
pub(super) fn boundary_contacts(shape: &Shape, fronts: &[Front]) -> Vec<Front> {
    // A front kept below lies within 0.025 m of a side over part of the side's
    // extent, so it meets the shape's box grown by 0.025 m: fronts outside the
    // box grown by 0.05 m are dropped first, the others keep their order.
    let (x0, y0, x1, y1) = super::super::geometry::bbox(shape);
    let near: Vec<Front> = fronts.iter().filter(|f| {
        f.a.x.max(f.b.x) >= x0 - 0.05 && f.a.x.min(f.b.x) <= x1 + 0.05
            && f.a.y.max(f.b.y) >= y0 - 0.05 && f.a.y.min(f.b.y) <= y1 + 0.05
    }).copied().collect();
    let fronts = near.as_slice();
    // Front geometry is immutable for this call. Evaluate the ORIGINAL
    // unit(sub(b,a)) once per front, lazily at the first nondegenerate edge,
    // rather than once for each (ring edge, front) pair. No candidate
    // reordering, predicate/tolerance or arithmetic formula changes.
    let directions=std::cell::OnceCell::<Vec<Point>>::new();
    let mut result = Vec::new();
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        let mut pieces = Vec::new();
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let edge = sub(b, a);
            let len = length(edge);
            if len < 1e-7 {
                continue;
            }
            let axis = scale(edge, 1.0 / len);
            let mut spans = Vec::new();
            let directions=directions.get_or_init(||fronts.iter().map(|f|unit(sub(f.b,f.a))).collect());
            for (f,&direction) in fronts.iter().zip(directions) {
                if dot(direction, axis) < 1.0 - 1e-8
                    || dot(sub(f.a, a), normal(axis)).abs() > 0.025
                    || dot(sub(f.b, a), normal(axis)).abs() > 0.025
                {
                    continue;
                }
                let lo = dot(sub(f.a, a), axis).max(0.0);
                let hi = dot(sub(f.b, a), axis).min(len);
                if hi - lo > 1e-7 {
                    spans.push((lo, hi, *f));
                }
            }
            spans.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut end = 0.0_f64;
            for (lo, hi, f) in spans {
                let lo = lo.max(end);
                if hi - lo > 1e-7 {
                    pieces.push(Front {
                        a: add(a, scale(axis, lo)),
                        b: add(a, scale(axis, hi)),
                        ..f
                    });
                }
                end = end.max(hi);
            }
        }
        result.extend(merge(pieces));
    }
    #[cfg(test)]
    prepared_direction_tests::assert_legacy(shape,fronts,&result);
    result
}

#[cfg(test)]
#[path="contacts_prepared_direction_tests.rs"]
mod prepared_direction_tests;
