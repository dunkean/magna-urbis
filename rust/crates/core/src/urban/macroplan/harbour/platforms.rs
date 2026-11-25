//! Cadastral ground and platforms associated with harbour streets.

use super::*;

/// Depth (m) of the service strip behind a quay: the curtain of a harbour outside passes behind it.
const SERVICE_STRIP: f64 = 15.0;
/// Quays closer than this (m) share one harbour front.
const FRONT_GAP: f64 = 40.0;

/// The harbour fronts of a plan, which a town wall passes behind when it is traced
/// (`fortification::water_fronts`): one continuous strip of constant depth along each run of quays,
/// the quays with their service band, closed over the gaps between them. The landing rows behind it
/// stay inside the wall and reach the quay through the gates of the gate budget. `inside`, the
/// strip is the quay alone: the curtain stands right behind it.
pub(in super::super::super) fn fronts(streets: &[Street], inside: bool) -> Vec<Shape> {
    let strip = if inside { 1.0 } else { SERVICE_STRIP };
    let ribbons: Vec<Shape> = streets.iter().filter(|s| s.role == "quay" && s.path.len() >= 2)
        .flat_map(|s| {
            let width = s.widths.iter().copied().fold(0.0, f64::max) + 2.0 * strip;
            g::ribbon(&s.path, &vec![width; s.path.len()])
        }).collect();
    if ribbons.is_empty() {
        return ribbons;
    }
    let quays = geo::MultiPolygon(g::union(&ribbons).iter().map(g::polygon).collect());
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(super::super::super::composition::closing(&quays, FRONT_GAP * 0.5)))).unwrap_or(ribbons)
}

fn timber_port(culture: &str) -> bool {
    let c = &super::super::super::catalogue()["cultures"][culture];
    c["render"]["stilts"].as_bool() == Some(true)
        || matches!(c["plan"]["harbour"]["material"].as_str(), Some("wood" | "timber"))
}

// Boundary contact counts too: flat pier caps often share only an edge with
// their landing. Bounding boxes avoid polygon work for unrelated waterfronts.
fn platforms_touch(a: &Shape, b: &Shape) -> bool {
    let (ax0, ay0, ax1, ay1) = g::bbox(a);
    let (bx0, by0, bx1, by1) = g::bbox(b);
    if ax1 + 1e-6 < bx0 || bx1 + 1e-6 < ax0 || ay1 + 1e-6 < by0 || by1 + 1e-6 < ay0 { return false; }
    a.outer.iter().any(|&p| g::contains(b, p)) || b.outer.iter().any(|&p| g::contains(a, p))
        || (0..a.outer.len()).any(|i| (0..b.outer.len()).any(|j| {
            let (p, q) = (a.outer[i], a.outer[(i + 1) % a.outer.len()]);
            let (r, s) = (b.outer[j], b.outer[(j + 1) % b.outer.len()]);
            g::segment_hit(p, q, r, s).is_some() || g::distance(p, r, s).0 < 1e-6 || g::distance(r, p, q).0 < 1e-6
        }))
}

/// Keep only waterfront components rooted on physical dry ground. A pier
/// or boardwalk can support an offshore landing, but an isolated deck cannot.
fn retain_attached_platforms(platforms: &mut Vec<Quay>, streets: &[Street], surface: Surface<'_>) {
    if platforms.is_empty() { return; }
    let mut shapes: Vec<_> = platforms.iter().map(|q| q.shape.clone()).collect();
    shapes.extend(streets.iter().filter(|s| s.role == "boardwalk")
        .flat_map(|s| g::ribbon(&s.path, &s.widths)));
    let mut attached: Vec<_> = shapes.iter().map(|s| s.outer.iter().any(|&p|
        p.x >= 0.0 && p.y >= 0.0 && p.x <= surface.width && p.y <= surface.width && !surface.wet(p))
        || g::dry_clip(&surface, s).iter().map(g::area).sum::<f64>() > 1e-6).collect();
    let mut queue: Vec<_> = (0..shapes.len()).filter(|&i| attached[i]).collect();
    while let Some(i) = queue.pop() {
        for j in 0..shapes.len() {
            if !attached[j] && platforms_touch(&shapes[i], &shapes[j]) {
                attached[j] = true;
                queue.push(j);
            }
        }
    }
    let mut i = 0;
    platforms.retain(|_| { let keep = attached[i]; i += 1; keep });
}

/// Stone ports retain their shore apron; timber ports use narrow decks and
/// small offshore landing stages. `surface` must be the physical water mask.
pub(in super::super::super) fn platforms(layout: &mut super::super::super::Layout, surface: Surface<'_>) {
    let mut platforms = vec![];
    let timber = timber_port(&layout.culture);
    let aprons = if timber { vec![] } else { seaward(&layout.streets, surface) };
    let quay_ribbons: Vec<Shape> = layout.streets.iter().filter(|s| s.role == "quay")
        .flat_map(|s| {
            if !timber { return g::ribbon(&s.path, &s.widths); }
            let offshore = !s.path.is_empty() && s.path.iter().all(|&p| surface.wet(p));
            let path = if offshore {
                // Centre the short stage on its nearest pier contact, not on
                // the old quay midpoint (which can leave a gap at either end).
                let anchor = layout.streets.iter().filter(|p| matches!(p.role.as_str(), "pier" | "landing" | "boardwalk"))
                    .flat_map(|p| &p.path).min_by(|a, b| {
                        let gap = |p: Point| s.path.windows(2).map(|w| g::distance(p, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
                        gap(**a).total_cmp(&gap(**b))
                    }).copied().unwrap_or(layout.center);
                centred(&s.path, anchor, 8.0)
            } else { s.path.clone() };
            g::ribbon(&path, &vec![4.0; path.len()])
        }).chain(aprons.iter().flat_map(|(p, w)| g::ribbon(p, w))).collect();
    let mut add = |shape: Shape, kind: &str, material: &str| {
        // Local bank-height fallback; retained terrain replaces it with physical water levels.
        let wet: Vec<f64> = shape.outer.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p)).collect();
        let level = if wet.is_empty() { shape.outer.iter().map(|&p| surface.height_at(p)).fold(f64::INFINITY, f64::min) }
            else { wet.into_iter().fold(f64::INFINITY, f64::min) };
        if level.is_finite() { platforms.push(Quay { kind: kind.into(), shape, deck_z_m: level + 1.0, material: material.into() }); }
    };
    for shape in g::union(&quay_ribbons) {
        let (lo, hi) = shape.outer.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p))
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), z| (lo.min(z), hi.max(z)));
        if timber { add(shape, "landing", "timber"); continue; }
        // A stone quay reaches the drawn water (its apron ends a metre past
        // the waterline): a platform with no corner on the water stands
        // detached from it and is no quay.
        if lo > hi { continue; }
        if hi - lo <= 0.8 { add(shape, "quay", "stone"); continue; }
        // Long rivers descend: local slabs follow the water rather than one
        // level platform disappearing under the upstream bank.
        let (x0, y0, x1, y1) = g::bbox(&shape);
        let horizontal = x1 - x0 > y1 - y0;
        let (start, end) = if horizontal { (x0, x1) } else { (y0, y1) };
        let mut at = start;
        while at < end {
            let next = (at + 40.0).min(end);
            let tile = if horizontal { g::rectangle(at, y0 - 1.0, next, y1 + 1.0) }
                else { g::rectangle(x0 - 1.0, at, x1 + 1.0, next) };
            for part in g::intersection(&shape, &tile) { add(part, "quay", "stone"); }
            at = next;
        }
    }
    for st in layout.streets.iter().filter(|s| matches!(s.role.as_str(), "pier" | "landing" | "mole")) {
        for shape in g::ribbon(&st.path, &st.widths) { add(shape, &st.role, if !timber && st.role == "mole" { "stone" } else { "timber" }); }
    }
    retain_attached_platforms(&mut platforms, &layout.streets, surface);
    if let Some(structure) = layout.structure.as_mut() { structure.quays = platforms; }
}
