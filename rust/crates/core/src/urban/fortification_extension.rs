//! Extension walls: a town that grew on one side builds its new enclosure
//! against the old one. The extension wall meets the old wall at two points
//! and the stretch between them is shared: it stays the boundary between old
//! town and new town. The old circuit and the extension are two closed
//! enclosures whose union is one closed outline.
use super::*;

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
mod tests {
    use super::*;

    #[test]
    fn an_attached_extension_shares_a_stretch_of_the_old_wall_and_the_union_stays_closed() {
        let old = g::rectangle(0.0, 0.0, 400.0, 400.0);
        // Every epoch's circuit hugs the old one at a few metres and runs on to the east.
        let full = g::rectangle(-4.0, -4.0, 800.0, 404.0);
        assert!(lopsided(&old, &full) && attach(&old, &full).is_some(), "lopsided growth attaches by itself");
        let balanced = g::rectangle(-200.0, -200.0, 600.0, 600.0);
        assert!(!lopsided(&old, &balanced), "balanced growth stays concentric");
        let ext = attach(&old, &full).expect("an extension");
        assert!(shared_length(&old, &ext) > 300.0, "shared stretch {}", shared_length(&old, &ext));
        assert!(g::intersection(&old, &ext).iter().map(g::area).sum::<f64>() < 1.0, "no overlap");
        let union = g::union(&[old.clone(), ext.clone()]);
        assert!(matches!(union.as_slice(), [one] if one.holes.is_empty() && g::simple(one)), "closed, simple outline");
        assert!(g::simple(&ext));
        // A round old town (contour or bastioned trace) with its growth to one side.
        let round = disc(pt(300.0, 300.0), 250.0, 48, 0.0);
        let grown = g::union(&[round.clone(), disc(pt(620.0, 300.0), 260.0, 48, 0.3)]).remove(0);
        assert!(lopsided(&round, &grown));
        let ext = attach(&round, &grown).expect("a round extension");
        assert!(shared_length(&round, &ext) > 100.0);
        assert!(matches!(g::union(&[round.clone(), ext.clone()]).as_slice(), [one] if one.holes.is_empty() && g::simple(one)));
        // Gates and towers on the shared stretch are drawn once and are inner gates of the old wall.
        let ring = |s: &Shape| { let mut p = s.outer.clone(); p.push(p[0]); p };
        let (on_stretch, outside) = (pt(400.0, 200.0), pt(0.0, 200.0));
        let tower = |p: Point| Tower { anchor: p, center: p, shape: "round".into(), radius_m: 5.0, depth_m: 0.0, angle: 0.0, height_m: 9.0, kind: "flank".into(), footprint: old.clone() };
        let mut o = Enclosure { path: ring(&old), gates: vec![on_stretch, outside], ..Default::default() };
        let mut e = Enclosure { path: ring(&ext), gates: vec![on_stretch], towers: vec![on_stretch], towers_detail: vec![tower(on_stretch)], ..Default::default() };
        let ext = attach(&old, &full).unwrap();
        dedupe_shared(&mut e, &old);
        inner_gates(&mut o, &ext);
        assert!(e.gates.is_empty() && e.towers_detail.is_empty() && e.towers.is_empty());
        assert_eq!(o.inner_gates, vec![0]);
    }
}
