//! Older circuits a grown town retains, and extension walls: a town that grew on one side builds its new enclosure
//! against the old one. The extension wall meets the old wall at two points
//! and the stretch between them is shared: it stays the boundary between old
//! town and new town. The old circuit and the extension are two closed
//! enclosures whose union is one closed outline.

use crate::urban::{Enclosure, Point, Shape, Work, geometry as g};
use super::geometry::{buffer_all, dir, dist, dot};

/// Growth is lopsided when the centroid of every epoch's circuit sits more
/// than a third of the old radius from the old centroid.
pub(in super::super) fn lopsided(old: &Shape, full: &Shape) -> bool {
    let radius = (g::area(old) / std::f64::consts::PI).sqrt();
    let (co, cf) = (g::centroid(old), g::centroid(full));
    (co.x - cf.x).hypot(co.y - cf.y) >= 0.33 * radius
}

/// The extension of `old` towards `full` (the circuit of every epoch), or
/// `None` when the geometry does not allow one. The result is a single polygon
/// outside `old` whose boundary runs along a stretch of `old`'s boundary
/// exactly, and `old ∪ extension` is one simple polygon.
pub(in super::super) fn attach(old: &Shape, full: &Shape) -> Option<Shape> {
    let a_old = g::area(old);
    // Thin slivers between the two traces are not extensions.
    let reach = (0.04 * a_old.sqrt()).clamp(10.0, 40.0);
    let ext: Vec<Shape> = g::difference(full, old);
    let opened = buffer_all(&buffer_all(&ext, -reach), reach);
    // Grown into the old town, then cut by it: the shared stretch is old's own boundary.
    let ext = buffer_all(&opened, 3.0)
        .iter()
        .flat_map(|s| g::difference(s, old))
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
    let ext = Shape { outer: ext.outer, holes: vec![] };
    if g::area(&ext) < 15_000.0 || g::area(&ext) < 0.1 * a_old || shared_length(old, &ext) < 3.0 * reach {
        return None;
    }
    match g::union(&[old.clone(), ext.clone()]).as_slice() {
        [one] if one.holes.is_empty() && g::simple(one) => Some(ext),
        _ => None,
    }
}

/// Older circuits a grown town retains inside its outer one, at most.
const RETAINED: usize = 2;
/// A circuit over this share of the one round it stands too close to it: the newer one replaced it.
const OUTGROWN: f64 = 0.6;
/// A curtain within this distance (m) of another that it runs along (within 45°) is its twin.
const TWIN_REACH: f64 = 30.0;
/// Longest run (m) an older circuit keeps as the twin of a newer one. Beyond it the newer wall took
/// its place there, and a circuit cannot stand open: it was demolished whole.
const TWIN_RUN: f64 = 60.0;

/// The `older` circuits (oldest first) that still stand inside `walls`: the founding circuit and at
/// most one between it and the outer wall, each clear of the others (a palace, an inner and an outer
/// city, never a stack of parallel curtains).
pub(in super::super) fn retained(older: Vec<Shape>, walls: &[Shape]) -> Vec<Shape> {
    let mut kept: Vec<Shape> = vec![];
    for s in older {
        let (middle, area) = (g::interior_point(&s), g::area(&s));
        let nested: Vec<&Shape> = kept.iter().filter(|k| g::contains(&s, g::interior_point(k))).collect();
        let crowded = !nested.is_empty()
            && (nested.iter().any(|k| g::area(k) > OUTGROWN * area) || walls.iter().any(|w| g::contains(w, middle) && area > OUTGROWN * g::area(w)));
        let free = nested.len() < RETAINED && !crowded && twin_run(&s, walls.iter().chain(&kept)) <= TWIN_RUN;
        if free {
            kept.push(s);
        }
    }
    kept
}

/// A refit that draws a circuit up against an older one inside it leaves a single curtain: the older
/// circuit goes when it runs as a twin of a circuit round it (`TWIN_RUN`).
pub(in super::super) fn drop_twins(enclosures: &mut Vec<Enclosure>) {
    let rings: Vec<Option<Shape>> = enclosures.iter()
        .map(|e| (e.purpose.is_empty() && e.path.len() >= 4).then(|| Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] }))
        .collect();
    let twin = |s: &Shape| {
        let (middle, area) = (g::interior_point(s), g::area(s));
        rings.iter().flatten().any(|o| g::area(o) > area && g::contains(o, middle) && twin_run(s, std::iter::once(o)) > TWIN_RUN)
    };
    let gone: Vec<bool> = rings.iter().map(|r| r.as_ref().is_some_and(|s| twin(s))).collect();
    let mut gone = gone.into_iter();
    enclosures.retain(|_| !gone.next().unwrap_or(false));
}

/// Longest run (m) of the ring of `s` along a ring of `others`, within `TWIN_REACH` of it.
fn twin_run<'a>(s: &Shape, others: impl Iterator<Item = &'a Shape>) -> f64 {
    let sides: Vec<(Point, Point)> = others.flat_map(|o| (0..o.outer.len()).map(move |i| (o.outer[i], o.outer[(i + 1) % o.outer.len()]))).collect();
    let n = s.outer.len();
    // (length, twin) along the ring.
    let mut samples: Vec<(f64, bool)> = vec![];
    for i in 0..n {
        let (a, b) = (s.outer[i], s.outer[(i + 1) % n]);
        let steps = (dist(a, b) / 10.0).ceil().max(1.0) as usize;
        for k in 0..steps {
            let t = (k as f64 + 0.5) / steps as f64;
            let p = Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            let twin = sides.iter().any(|&(c, d)| g::distance(p, c, d).0 < TWIN_REACH && dot(dir(a, b), dir(c, d)).abs() > 0.7);
            samples.push((dist(a, b) / steps as f64, twin));
        }
    }
    // From a sample that is no twin, so that no run wraps round the seam.
    let Some(start) = samples.iter().position(|x| !x.1) else { return samples.iter().map(|x| x.0).sum() };
    let (mut longest, mut run) = (0.0_f64, 0.0);
    for k in 0..samples.len() {
        let (length, twin) = samples[(start + k) % samples.len()];
        run = if twin { run + length } else { 0.0 };
        longest = longest.max(run);
    }
    longest
}

/// Length of `b`'s ring lying on `a`'s ring.
pub(in super::super) fn shared_length(a: &Shape, b: &Shape) -> f64 {
    let m = a.outer.len();
    let on = |p: Point| (0..m).any(|i| g::distance(p, a.outer[i], a.outer[(i + 1) % m]).0 < 0.5);
    let n = b.outer.len();
    (0..n).map(|i| (b.outer[i], b.outer[(i + 1) % n]))
        .filter(|&(p, q)| on(p) && on(q) && on(Point { x: (p.x + q.x) / 2.0, y: (p.y + q.y) / 2.0 }))
        .map(|(p, q)| dist(p, q)).sum()
}

/// Ditch, outworks and lean-tos of an enclosure never run into the land of
/// the enclosure it shares a stretch with.
pub(in super::super) fn trim_shared(e: &mut Enclosure, other: &Shape) {
    let cut = |w: &mut Vec<Work>| {
        *w = std::mem::take(w).into_iter().flat_map(|k| {
            g::difference(&k.shape, other).into_iter().filter(|s| g::area(s) > 20.0)
                .map(move |shape| Work { shape, ..k.clone() })
        }).collect();
    };
    cut(&mut e.ditch);
    cut(&mut e.outworks);
    cut(&mut e.bastions);
    e.attached.retain(|a| !g::contains(other, g::centroid(&a.shape)));
    e.reserve = std::mem::take(&mut e.reserve).iter()
        .flat_map(|s| g::difference(s, other)).filter(|s| g::area(s) > 1.0).collect();
}

/// Gates of `kept` that open on the extension `other` are inner gates, between
/// old and new town: listed in `inner_gates`, not outer gates.
pub(in super::super) fn inner_gates(kept: &mut Enclosure, other: &Shape) {
    let m = other.outer.len();
    let on = |p: Point| (0..m).any(|i| g::distance(p, other.outer[i], other.outer[(i + 1) % m]).0 < 3.0);
    kept.inner_gates = kept.gates.iter().enumerate().filter(|&(_, &p)| on(p)).map(|(i, _)| i).collect();
}

/// Towers and gates of `e` standing on the ring of `kept` (the enclosure that
/// keeps the shared stretch) are dropped: the stretch is drawn once.
pub(in super::super) fn dedupe_shared(e: &mut Enclosure, kept: &Shape) {
    let m = kept.outer.len();
    let on = |p: Point| (0..m).any(|i| g::distance(p, kept.outer[i], kept.outer[(i + 1) % m]).0 < 3.0);
    let keep: Vec<bool> = e.towers_detail.iter().map(|t| !on(t.anchor)).collect();
    let mut flags = keep.iter();
    e.towers_detail.retain(|_| *flags.next().unwrap());
    e.towers = e.towers_detail.iter().map(|t| t.anchor).collect();
    let gate_keep: Vec<bool> = e.gates.iter().map(|&p| !on(p)).collect();
    let remap: Vec<usize> = gate_keep.iter().scan(0, |n, &k| { let i = *n; if k { *n += 1; } Some(i) }).collect();
    e.gatehouses.retain(|h| gate_keep.get(h.gate).copied().unwrap_or(true));
    for h in &mut e.gatehouses { h.gate = remap[h.gate]; }
    let mut flags = gate_keep.iter();
    e.gates.retain(|_| *flags.next().unwrap());
}

#[cfg(test)]
#[path = "extension_tests.rs"]
mod tests;
