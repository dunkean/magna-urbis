//! Admission envelopes and their per-parcel probe memo.

use super::contacts::{Front, parcel_fronts};
use super::contacts;
use super::cut_geometry::{add, bounds, distance, dot, length, normal, scale, sub, unit};
use crate::urban::{Parcel, Point, Shape};

/// Provenance of a lot admitted by a witness at any orientation (odd ground).
pub(super) const POLYGONAL: &str = "polygonal-lot";
/// How far from its contact the witness of such a lot may stand, in metres.
pub(super) const POLYGONAL_REACH: f64 = 3.0;
/// Provenance of a lot too small or thin for the native admission rectangle,
/// kept built with the largest scaled-down body it holds (shed, annex, narrow
/// house of odd ground).
pub(super) const DEGENERATE: &str = "degenerate-lot";
/// Smallest side (m) of the body the occupation keeps on a degenerate lot. It lies under the smallest
/// scaled admission rectangle, so a lot that is admitted is a lot that is built (a shed, an annex).
pub(super) const MIN_BODY_SIDE: f64 = 2.0;
/// Scales of the admission rectangle tried for a degenerate lot.
pub(super) const DEGENERATE_SCALES: [f64; 4] = [1.0, 0.85, 0.7, 0.55];

/// Shared exact witness used by allocation as well as cadastral qualification.
/// Courtyard-family lots are entered through a gate: any contact as wide as
/// the access admits a house set anywhere inside the lot.
pub(in crate::urban) fn parcel_envelope(
    p: &Parcel,
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    parcel_envelope_with(p, &envelope_fronts(p), width, depth, access_width)
}
/// The per-parcel part of `parcel_envelope` (fronts, contacts, support spans),
/// computed once for every witness size tested on the same parcel.
pub(in crate::urban) fn envelope_fronts(p: &Parcel) -> Vec<Front> {
    let inward = p.family == "courtyard";
    parcel_fronts(p)
        .into_iter()
        .map(|f| Front {
            gate: f.gate || inward,
            ..f
        })
        .collect()
}
pub(in crate::urban) fn parcel_envelope_with(
    p: &Parcel,
    fronts: &[Front],
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    envelope(&p.shape, fronts, width, depth, access_width).or_else(|| {
        // A lot of odd ground (`polygonal-lot`) was admitted by a rectangle at
        // any orientation; allocation and sites ask the same question.
        let degenerate = p.provenance.iter().any(|x| x == DEGENERATE);
        if !degenerate && !p.provenance.iter().any(|x| x == POLYGONAL) {
            return None;
        }
        // A degenerate lot keeps the largest body of the admission shape it holds.
        let scales: &[f64] = if degenerate { &DEGENERATE_SCALES } else { &[1.0] };
        scales.iter().copied().find_map(|k| {
            free_envelope(
                &p.shape,
                fronts,
                width * k,
                depth * k,
                access_width,
                POLYGONAL_REACH,
            )
        })
    })
}
/// Memoised witnesses (`probe_cache`) shared by the allocation passes of one
/// quarters run, per lot then per admission size.
static ENVELOPES: crate::urban::probe_cache::Memo<std::sync::Arc<EnvelopeMemo>> = crate::urban::probe_cache::Memo::new();
#[derive(Default)]
pub(in crate::urban) struct EnvelopeMemo(std::sync::Mutex<std::collections::HashMap<(u64, u64, u64), bool>>);
/// The witness memo of one lot. The search (`parcel_envelope_with`) reads
/// only the lot outline, its fronts (streets compared for identity only) and
/// its degenerate/polygonal provenance, so those are the key. `None` when
/// the probe memo is off.
pub(in crate::urban) fn envelope_memo(p: &Parcel, fronts: &[Front]) -> Option<std::sync::Arc<EnvelopeMemo>> {
    if !crate::urban::probe_cache::enabled() {
        return None;
    }
    let mut k = crate::urban::probe_cache::Key::new("parcels.envelope/v1");
    k.shape(&p.shape)
        .bool(p.provenance.iter().any(|x| x == DEGENERATE))
        .bool(p.provenance.iter().any(|x| x == POLYGONAL));
    let mut streets: Vec<usize> = fronts.iter().map(|f| f.street).collect();
    streets.sort_unstable();
    streets.dedup();
    k.usize(fronts.len());
    for f in fronts {
        let local = streets.binary_search(&f.street).expect("listed street");
        k.point(f.a).point(f.b).usize(f.rank).usize(local).bool(f.shared).bool(f.gate);
    }
    if let Some(hit) = ENVELOPES.get(&k) {
        return Some(hit);
    }
    let memo = std::sync::Arc::new(EnvelopeMemo::default());
    ENVELOPES.put(k, memo.clone());
    Some(memo)
}
impl EnvelopeMemo {
    /// `parcel_envelope_with(..).is_some()` for the lot this memo was made for.
    pub(in crate::urban) fn has(&self, p: &Parcel, fronts: &[Front], width: f64, depth: f64, access_width: f64) -> bool {
        let key = (width.to_bits(), depth.to_bits(), access_width.to_bits());
        if let Some(&hit) = self.0.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
            return hit;
        }
        let ok = parcel_envelope_with(p, fronts, width, depth, access_width).is_some();
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(key, ok);
        ok
    }
}
/// Uncut reserves use the same admission search without synthetic properties.
pub(in crate::urban) fn contact_envelope(
    shape: &Shape,
    contacts: &[crate::urban::ParcelContact],
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    let fronts: Vec<_> = contacts
        .iter()
        .map(|c| Front {
            a: c.a,
            b: c.b,
            street: c.street,
            rank: c.rank,
            shared: c.kind == "collective",
            gate: matches!(c.kind.as_str(), "private" | "collective"),
        })
        .collect();
    envelope(shape, &fronts, width, depth, access_width)
}

pub(super) fn clear_probe_cache() {
    ENVELOPES.clear();
}

/// Exact convex-rectangle containment, holes included: no boundary edge enters
/// the rectangle shrunk by 0.1 mm, and its centre lies inside. One Liang-Barsky
/// clip per boundary edge tests those crossings.
pub(super) fn rect_within(
    shape: &Shape,
    a: Point,
    u: Point,
    v: Point,
    width: f64,
    depth: f64,
) -> bool {
    const EPS: f64 = 1e-4;
    let (s0, s1, t0, t1) = (EPS, width - EPS, EPS, depth - EPS);
    if s1 <= s0 || t1 <= t0 {
        return false;
    }
    let local = |p: Point| {
        let d = sub(p, a);
        (dot(d, u), dot(d, v))
    };
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        for (&p, &q) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let ((px, py), (qx, qy)) = (local(p), local(q));
            if px.max(qx) <= s0 || px.min(qx) >= s1 || py.max(qy) <= t0 || py.min(qy) >= t1 {
                continue;
            }
            let (dx, dy) = (qx - px, qy - py);
            let (mut enter, mut exit) = (0.0_f64, 1.0_f64);
            let mut inside = true;
            for (pk, qk) in [(-dx, px - s0), (dx, s1 - px), (-dy, py - t0), (dy, t1 - py)] {
                if pk.abs() < 1e-15 {
                    if qk < 0.0 {
                        inside = false;
                        break;
                    }
                } else if pk < 0.0 {
                    enter = enter.max(qk / pk);
                } else {
                    exit = exit.min(qk / pk);
                }
            }
            if inside && enter <= exit {
                return false;
            }
        }
    }
    super::super::geometry::contains(
        shape,
        add(a, add(scale(u, width * 0.5), scale(v, depth * 0.5))),
    )
}

/// A bounded admissibility witness, checked by exact rectangle containment
/// (including holes). Failed search is a refusal, not proof that no plan exists.
pub(super) fn envelope(
    shape: &Shape,
    fronts: &[Front],
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    let contacts = contacts::boundary_contacts(shape, fronts);
    let mut candidates: Vec<_> = contacts
        .iter()
        .zip(contacts::support_spans(&contacts))
        .map(|(f, (lo, hi))| (*f, lo, hi))
        .filter(|(f, lo, hi)| hi - lo + 1e-6 >= if f.gate { access_width } else { width })
        .collect();
    // Bound useful candidates, rather than hiding the only long frontage
    // behind twelve short curved pieces in input vertex order.
    candidates.sort_by(|a, b| {
        (b.2 - b.1)
            .total_cmp(&(a.2 - a.1))
            .then(a.0.rank.cmp(&b.0.rank))
            .then(a.0.a.x.total_cmp(&b.0.a.x))
            .then(a.0.a.y.total_cmp(&b.0.a.y))
    });
    for (f, lo, hi) in candidates.into_iter().take(12) {
        let u = unit(sub(f.b, f.a));
        let v = normal(u);
        let len = hi - lo;
        // Do not search from a frontage too short for the admissible entry.
        if len + 1e-6 < if f.gate { access_width } else { width } {
            continue;
        }
        for t in [0.5, 0.25, 0.75, 0.0, 1.0] {
            let along = lo + (len - width) * t;
            for setback in [0.0, 0.5, 1.5, 3.0] {
                let a = add(add(f.a, scale(u, along)), scale(v, setback));
                if rect_within(shape, a, u, v, width, depth) {
                    return Some(rect(a, u, v, width, depth));
                }
            }
        }
        if f.gate {
            let (u0, u1) = bounds(shape, u);
            let (v0, v1) = bounds(shape, v);
            if u1 - u0 + 1e-6 >= width && v1 - v0 + 1e-6 >= depth {
                for along in [0.5, 0.25, 0.75, 0.0, 1.0] {
                    for across in [0.0, 0.25, 0.5, 0.75, 1.0] {
                        let a = add(
                            scale(u, u0 + (u1 - u0 - width) * along),
                            scale(v, v0 + (v1 - v0 - depth) * across),
                        );
                        if rect_within(shape, a, u, v, width, depth) {
                            return Some(rect(a, u, v, width, depth));
                        }
                    }
                }
            }
        }
    }
    None
}

/// Witness of a lot of odd ground: the admission rectangle at any orientation
/// (along a street contact or a long side of the lot), placed where it lies
/// closest to a contact reaching `access_width`. A wedge, an L or a slanted
/// lot that holds no street-aligned rectangle still holds a house, and the
/// polygon house of such a lot keeps this body inside it. `reach` is how far
/// the rectangle may stand from the contact (a setback, not a hole).
pub(super) fn free_envelope(
    shape: &Shape,
    fronts: &[Front],
    width: f64,
    depth: f64,
    access_width: f64,
    reach: f64,
) -> Option<Shape> {
    let contacts = contacts::boundary_contacts(shape, fronts);
    let served: Vec<(Point, Point)> = contacts
        .iter()
        .enumerate()
        .filter(|&(i, _)| {
            let (lo, hi) = contacts::support_span(&contacts, i);
            hi - lo + 1e-6 >= access_width
        })
        .map(|(_, f)| (f.a, f.b))
        .collect();
    if served.is_empty() {
        return None;
    }
    // Sample points of the served contacts, every 0.5 m (at most 48 in all).
    let mut marks: Vec<Point> = Vec::new();
    for &(a, b) in &served {
        let n = ((length(sub(b, a)) / 0.5).ceil() as usize).clamp(1, 48);
        marks.extend((0..=n).map(|k| add(a, scale(sub(b, a), k as f64 / n as f64))));
    }
    if marks.len() > 96 {
        let step = marks.len().div_ceil(96);
        marks = marks.into_iter().step_by(step).collect();
    }
    let mut dirs: Vec<(f64, Point)> = served
        .iter()
        .map(|&(a, b)| (length(sub(b, a)), unit(sub(b, a))))
        .collect();
    let ring = &shape.outer;
    dirs.extend(
        ring.iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
            .map(|(&p, &q)| (length(sub(q, p)), unit(sub(q, p))))
            .filter(|(l, _)| *l >= 2.0),
    );
    dirs.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut axes: Vec<Point> = Vec::new();
    for (_, d) in dirs {
        if axes.len() >= 10 {
            break;
        }
        if axes.iter().all(|a| dot(*a, d).abs() < 0.9994) {
            axes.push(d);
        }
    }
    // The smallest mark-to-side distance (`distance`, a hypot). Squared
    // lengths of the same offset vectors rank the pairs first; only pairs
    // within a relative 1e-9 of the smallest take the exact hypot, so the
    // value is the original minimum bit for bit.
    let gap = |c: &[Point; 4]| {
        let offset = |m: Point, a: Point, b: Point| {
            let d = sub(b, a);
            sub(m, add(a, scale(d, (dot(sub(m, a), d) / dot(d, d).max(1e-12)).clamp(0.0, 1.0))))
        };
        let mut least = f64::INFINITY;
        for &m in &marks {
            for k in 0..4 {
                let o = offset(m, c[k], c[(k + 1) % 4]);
                least = least.min(o.x * o.x + o.y * o.y);
            }
        }
        let cut = least * (1.0 + 1e-9) + 1e-300;
        let mut g = f64::INFINITY;
        for &m in &marks {
            for k in 0..4 {
                let o = offset(m, c[k], c[(k + 1) % 4]);
                if o.x * o.x + o.y * o.y <= cut {
                    g = g.min(distance(m, c[k], c[(k + 1) % 4]));
                }
            }
        }
        g
    };
    let mut best: Option<(f64, Shape)> = None;
    let mut swapped = false;
    for u in axes {
        let v0 = normal(u);
        for (w, d) in [(width, depth), (depth, width)] {
            let turned = w != width;
            for sign in [1.0, -1.0] {
                let v = scale(v0, sign);
                let (s0, s1) = bounds(shape, u);
                let (t0, t1) = bounds(shape, v);
                if s1 - s0 + 1e-6 < w || t1 - t0 + 1e-6 < d {
                    continue;
                }
                let (ds, dt) = (
                    ((s1 - s0 - w) / 24.0).max(0.4),
                    ((t1 - t0 - d) / 24.0).max(0.4),
                );
                let mut s = s0;
                while s <= s1 - w + 1e-9 {
                    let mut t = t0;
                    while t <= t1 - d + 1e-9 {
                        let a = add(scale(u, s), scale(v, t));
                        if rect_within(shape, a, u, v, w, d) {
                            let r = rect(a, u, v, w, d);
                            let c = [r.outer[0], r.outer[1], r.outer[2], r.outer[3]];
                            let g = gap(&c);
                            if g <= reach && best.as_ref().is_none_or(|(b, _)| g < *b - 1e-9) {
                                best = Some((g, r));
                                swapped = turned;
                            }
                        }
                        t += dt;
                    }
                    s += ds;
                }
            }
        }
    }
    // The stored witness always reads width x depth from its first corner.
    best.map(|(_, mut r)| {
        if swapped {
            r.outer.rotate_left(1);
        }
        r
    })
}

pub(super) fn rect(a: Point, u: Point, v: Point, width: f64, depth: f64) -> Shape {
    Shape {
        outer: vec![
            a,
            add(a, scale(u, width)),
            add(add(a, scale(u, width)), scale(v, depth)),
            add(a, scale(v, depth)),
        ],
        holes: Vec::new(),
    }
}
