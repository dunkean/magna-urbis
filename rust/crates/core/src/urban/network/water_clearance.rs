//! Remove wet runs and pull back unsupported street ends on the physical surface.

use super::bridge_construction::deck_landing_grade;
use super::reservations::{remap_reservations, reserved_streets};
use super::spatial::{BoxGrid, EPS, Key, PointGrid, distance, key, lerp, segment_box};
use super::street::{CROSSINGS, private, width};
use super::deck_clearance::meets;
use crate::urban::{Layout, Point, Street, Surface};
use std::collections::{BTreeMap, BTreeSet};

/// Invariant (no street into water): once the decks are chosen, a street end
/// that nothing else meets (the approach of a dropped deck, a stub left on the
/// bank) clears the water by half its width plus 1 m. Such an end is walked
/// back along its own path to the first point whose clearance ring is dry,
/// never past a point another street meets. An end that runs along the bank
/// (no dry ring within a few widths) is only pulled back until it no longer
/// points into the water. A stub left shorter than two widths that links
/// nothing along its length is removed. Crossings, quays and harbour ways keep
/// their water ends; a junction used by another street is never cut.
pub(super) fn clear_bank_ends(streets: &mut Vec<Street>, surface: Surface<'_>) {
    use crate::urban::geometry as g;
    const TOUCH: f64 = 0.05;
    const STEP: f64 = 1.0;
    let exempt = |s: &Street| CROSSINGS.contains(&s.role.as_str()) || matches!(s.role.as_str(), "port" | "port-street");
    // Water, not the edge of the planning surface (which `wet` also reports):
    // a road leaving the map keeps its end.
    let water = |p: Point| p.x >= 0.0 && p.y >= 0.0 && p.x < surface.width && p.y < surface.width && surface.wet(p);
    // Water within `r` of `p`: the point, then two rings of samples.
    let wet_near = |p: Point, r: f64| -> bool {
        water(p) || (0..12).any(|i| {
            let (s, c) = (i as f64 * std::f64::consts::TAU / 12.0).sin_cos();
            water(Point { x: p.x + r * c, y: p.y + r * s }) || water(Point { x: p.x + 0.5 * r * c, y: p.y + 0.5 * r * s })
        })
    };
    for _ in 0..3 {
        let mut count: std::collections::HashMap<Key, usize> = Default::default();
        for s in streets.iter() {
            let n = s.path.len();
            for (i, &p) in s.path.iter().enumerate() { *count.entry(key(p)).or_default() += if i == 0 || i + 1 == n { 1 } else { 2 }; }
        }
        let mut loose: Vec<(usize, bool)> = vec![];
        for (i, s) in streets.iter().enumerate() {
            if s.path.len() < 2 || exempt(s) { continue; }
            for (at_start, k) in [(true, 0), (false, s.path.len() - 1)] {
                let p = s.path[k];
                if count.get(&key(p)) == Some(&1) && wet_near(p, width(s, k) * 0.5 + 1.0) { loose.push((i, at_start)); }
            }
        }
        if loose.is_empty() { break; }
        // Every vertex and segment, to find what meets a street off its shared vertices.
        let vertices: Vec<(Point, usize)> = streets.iter().enumerate().flat_map(|(i, s)| s.path.iter().map(move |&p| (p, i))).collect();
        let vgrid = BoxGrid::new(&vertices.iter().map(|&(p, _)| (p.x, p.y, p.x, p.y)).collect::<Vec<_>>(), 32.0);
        let segments: Vec<(Point, Point, usize)> = streets.iter().enumerate()
            .flat_map(|(i, s)| s.path.windows(2).map(move |w| (w[0], w[1], i))).collect();
        let sgrid = BoxGrid::new(&segments.iter().map(|&(a, b, _)| segment_box(a, b, 0.0)).collect::<Vec<_>>(), 32.0);
        let mut removed = vec![false; streets.len()];
        let mut changed = false;
        for (i, at_start) in loose {
            if removed[i] { continue; }
            let s = &streets[i];
            let mut path = s.path.clone();
            let mut widths: Vec<f64> = (0..path.len()).map(|k| width(s, k)).collect();
            if !at_start { path.reverse(); widths.reverse(); }
            let end = path[0];
            // Another street meeting the end off a shared vertex: not loose.
            let attached = sgrid.query(end.x - TOUCH, end.y - TOUCH, end.x + TOUCH, end.y + TOUCH).into_iter()
                .any(|k| { let (a, b, o) = segments[k]; o != i && g::distance(end, a, b).0 <= TOUCH })
                || vgrid.query(end.x - TOUCH, end.y - TOUCH, end.x + TOUCH, end.y + TOUCH).into_iter()
                    .any(|k| vertices[k].1 != i && distance(vertices[k].0, end) <= TOUCH);
            if attached { continue; }
            let mut arc = vec![0.0; path.len()];
            for k in 1..path.len() { arc[k] = arc[k - 1] + distance(path[k - 1], path[k]); }
            let total = arc[path.len() - 1];
            // Where other streets meet this one, measured from the loose end.
            let (mut first, mut interior) = (total, false);
            for k in 0..path.len() - 1 {
                let (a, b) = (path[k], path[k + 1]);
                let (x0, y0, x1, y1) = segment_box(a, b, TOUCH);
                for j in vgrid.query(x0, y0, x1, y1) {
                    let (q, o) = vertices[j];
                    if o == i { continue; }
                    let (d, t, _) = g::distance(q, a, b);
                    if d > TOUCH { continue; }
                    let at = arc[k] + t * (arc[k + 1] - arc[k]);
                    if at <= TOUCH { continue; }
                    first = first.min(at);
                    interior |= at < total - TOUCH;
                }
            }
            // Point at arc length `t` and the unit direction towards the loose end there.
            let sample = |t: f64| -> (Point, (f64, f64), usize) {
                let k = (1..path.len()).find(|&k| arc[k] >= t).unwrap_or(path.len() - 1) - 1;
                let length = (arc[k + 1] - arc[k]).max(EPS);
                let (a, b) = (path[k], path[k + 1]);
                (lerp(a, b, ((t - arc[k]) / length).clamp(0.0, 1.0)), ((a.x - b.x) / length, (a.y - b.y) / length), k)
            };
            let (w, clear) = (widths[0], widths[0] * 0.5 + 1.0);
            let heading_dry = |t: f64| {
                let (p, d, _) = sample(t);
                !water(p) && !water(Point { x: p.x + d.0 * clear, y: p.y + d.1 * clear })
            };
            let limit = first.min(total);
            let steps = |reach: f64| (1..).map(|n| n as f64 * STEP).take_while(move |&t| t <= reach + EPS);
            let ring = steps(limit.min((4.0 * clear).max(3.0 * w))).find(|&t| !wet_near(sample(t).0, clear));
            let cut = match ring {
                Some(t) => Some(t),
                // A dead end along the bank that does not point into the water stays.
                None if heading_dry(0.0) => continue,
                None => steps(limit).find(|&t| heading_dry(t)),
            };
            let remove = match cut {
                Some(t) => !interior && total - t < 2.0 * w,
                None => !interior,
            };
            changed = true;
            if remove { removed[i] = true; continue; }
            let t = cut.unwrap_or(limit);
            let (p, _, k) = sample(t);
            let (mut kept, mut kept_widths) = (vec![], vec![]);
            if distance(p, path[k + 1]) > 0.01 {
                let f = ((t - arc[k]) / (arc[k + 1] - arc[k]).max(EPS)).clamp(0.0, 1.0);
                kept.push(p); kept_widths.push(widths[k] + (widths[k + 1] - widths[k]) * f);
            }
            kept.extend_from_slice(&path[k + 1..]); kept_widths.extend_from_slice(&widths[k + 1..]);
            if kept.len() < 2 { removed[i] = true; continue; }
            if !at_start { kept.reverse(); kept_widths.reverse(); }
            streets[i].path = kept;
            streets[i].widths = kept_widths;
        }
        let mut n = 0;
        streets.retain(|_| { let keep = !removed[n]; n += 1; keep });
        if !changed { break; }
    }
}

/// Roles with their own water geometry (decks, platforms, supported joints).
pub(super) const WATER_ROLES: [&str; 9] = ["bridge", "ford", "causeway", "quay", "pier", "mole", "landing", "boardwalk", "walkway"];

/// Invariant (no earth street on water), asserted on the final street network
/// of a place, after the last stage that adds or moves its formal streets: on
/// the physical surface a street without a water role holds no wet metre. Each
/// wet run either becomes a deck on the street's own line (`dry_streets`) or
/// is cut at both banks. `reclaimed` is the stilt planning ground: a run that
/// stands on it is a boardwalk, as in `StiltGround::walkways`. Reservations
/// follow their street. Returns whether a street changed.
pub(in crate::urban) fn clear_water(layout: &mut Layout, population: u32, physical: Surface<'_>, reclaimed: Option<Surface<'_>>, max_grade: f64) -> bool {
    let _profile = crate::urban::routing::Profile::new("clear_water");
    if physical.geometry.is_none() && !physical.water.iter().any(|&w| w != 0) { return false; }
    let reserved = reserved_streets(layout);
    let culture = layout.culture.clone();
    // Water in a moat band is the moat's: a street crossing it there is a moat crossing.
    let bands = crate::urban::fortification::moat_bands(&layout.enclosures);
    let in_moat = |p: Point| bands.iter().any(|(band, town)| crate::urban::geometry::contains(band, p) && !town.as_ref().is_some_and(|t| crate::urban::geometry::contains(t, p)));
    let Some(first) = dry_streets(&mut layout.streets, &culture, population, physical, reclaimed, max_grade, &in_moat) else { return false; };
    // Pieces replace their street in place: indices shift, the witnesses follow.
    if let Some(p) = &mut layout.programme {
        for r in &mut p.reservations { r.street = first.get(r.street).copied().flatten().unwrap_or(0); }
    }
    remap_reservations(layout, &reserved);
    true
}

/// The pass of `clear_water` on a street list. Linear in street segments: one
/// `water_intervals` per segment, two corner probes per loose end, and a deck
/// fit per wet run only. No routing search; no vertex moves, so a junction
/// shared with another street stays exact.
/// - A wet run with a dry abutment on each bank becomes a deck (`bridge`, or
///   `ford` under the culture's ford width) under the existing rules: the span
///   the place builds (`crossings::spans`), a straight span within 15 degrees
///   of the channel normal and no longer than the fitted deck plus 4 m (the
///   retained-deck rule of `bridge_water`), landings within the street grade,
///   and no other crossing within `crossings::street_spacing`. Access ways
///   never bridge.
/// - Any other run is cut on each side, half the street width and 0.5 m short
///   of the water (a loose end is drawn with a round cap of that radius), or
///   at a junction lying inside that setback. A cut tail shorter than 4 m past
///   its last junction goes back to that junction; a piece cut on both sides
///   that meets no other street is dropped.
/// - A loose end whose centre line is dry but whose cap (tip or sides, half a
///   width out) stands on water is pulled back the same way, by at most that
///   setback. A street running along a bank closer than its half width keeps
///   its line: moving it would break its junctions and the blocks cut against it.
/// - Runs under 1 m (vector/raster seams) and short joints onto a deck, quay or
///   pier vertex stay.
///
/// Returns, per input street, the index of its first piece (`None`: dropped),
/// or `None` when nothing changed.
pub(super) fn dry_streets(streets: &mut Vec<Street>, culture: &str, population: u32, surface: Surface<'_>, reclaimed: Option<Surface<'_>>, max_grade: f64, in_moat: &(dyn Fn(Point) -> bool + Sync)) -> Option<Vec<Option<usize>>> {
    use crate::urban::{footprint::crossings, geometry as g, routing};
    const STUB: f64 = 4.0;
    // Dry abutment of a deck on each bank (`Crossing::streets`).
    const ABUTMENT: f64 = 2.0;
    const SEAM: f64 = 1.0;
    #[derive(Clone, Copy, PartialEq)]
    enum Cut { Trim, Deck, Platform }
    let exempt = |s: &Street| s.path.len() < 2 || WATER_ROLES.contains(&s.role.as_str());
    // Wet runs of each street, as stations along its path.
    let wet_runs: Vec<Vec<(f64, f64)>> = crate::urban::par::map(streets.as_slice(), |_, s| {
        let mut wet: Vec<(f64, f64)> = vec![];
        if exempt(s) { return wet; }
        let mut start = 0.0;
        for w in s.path.windows(2) {
            let len = distance(w[0], w[1]);
            for (a, b) in routing::water_intervals(surface, w[0], w[1]) {
                // A wet run whose middle lies in a moat band is left to the moat.
                if in_moat(lerp(w[0], w[1], 0.5 * (a + b))) { continue; }
                let (a, b) = (start + a * len, start + b * len);
                if let Some(last) = wet.last_mut().filter(|last| a - last.1 < 0.01) { last.1 = b; } else { wet.push((a, b)); }
            }
            start += len;
        }
        wet
    });
    let mut shared: BTreeMap<Key, usize> = BTreeMap::new();
    let mut anchors: BTreeSet<Key> = BTreeSet::new();
    for s in streets.iter() {
        let water = WATER_ROLES.contains(&s.role.as_str());
        for &p in &s.path {
            *shared.entry(key(p)).or_default() += 1;
            if water { anchors.insert(key(p)); }
        }
    }
    let platforms: Vec<(Point, Point, f64)> = streets.iter().filter(|s| WATER_ROLES.contains(&s.role.as_str())).flat_map(|s| {
        let half = s.widths.iter().copied().fold(1.0, f64::max) * 0.5;
        s.path.windows(2).map(move |w| (w[0], w[1], half))
    }).collect();
    // Boxes of the platform segments, grown by their half width: an end within
    // `half + h + 0.5` of one lies within `h + 0.5` of its grown box.
    let platform_grid = BoxGrid::new(&platforms.iter().map(|&(a, b, half)| segment_box(a, b, half)).collect::<Vec<_>>(), 32.0);
    let mut decks = PointGrid::new(streets.iter().filter(|s| s.path.len() >= 2 && matches!(s.role.as_str(), "bridge" | "ford" | "causeway"))
        .map(|s| lerp(s.path[0], *s.path.last().unwrap(), 0.5)).collect(), 64.0);
    let mut laid: Vec<Street> = streets.iter().filter(|s| matches!(s.role.as_str(), "bridge" | "ford")).cloned().collect();
    let (max_span, ford) = crossings::spans(culture, population);
    let old = std::mem::take(streets);
    let mut first: Vec<Option<usize>> = Vec::with_capacity(old.len());
    let mut changed = false;
    for (s, wet) in old.into_iter().zip(wet_runs) {
        if exempt(&s) { first.push(Some(streets.len())); streets.push(s); continue; }
        let n = s.path.len();
        let mut stations = Vec::with_capacity(n);
        let mut total = 0.0;
        stations.push(total);
        for w in s.path.windows(2) { total += distance(w[0], w[1]); stations.push(total); }
        let is_shared = |i: usize| shared.get(&key(s.path[i])).copied().unwrap_or(0) > 1;
        // Metres to pull a loose end back so that its cap (tip and both sides) stands on land.
        let overhang = |last: bool| -> f64 {
            let (i, j) = if last { (n - 1, n - 2) } else { (0, 1) };
            let (o, before) = (s.path[i], s.path[j]);
            let l = distance(before, o);
            // A spring path is matched by its exact line; a regional road meets the road beyond.
            if l < EPS || is_shared(i) || matches!(s.role.as_str(), "regional" | "path") { return 0.0; }
            let h = width(&s, i) * 0.5;
            let u = ((o.x - before.x) / l, (o.y - before.y) / l);
            let cap_dry = |d: f64| [(h, 0.0), (0.0, h), (0.0, -h)].iter()
                .all(|&(f, k)| !surface.wet(Point { x: o.x + u.0 * (f - d) - u.1 * k, y: o.y + u.1 * (f - d) + u.0 * k }));
            if cap_dry(0.0) || platform_grid.query(o.x - h - 0.5, o.y - h - 0.5, o.x + h + 0.5, o.y + h + 0.5).into_iter()
                .any(|k| { let (a, b, half) = platforms[k]; g::distance(o, a, b).0 <= half + h + 0.5 }) { return 0.0; }
            let reach = (h + 0.5).min(l);
            (1..=4).map(|k| reach * k as f64 / 4.0).find(|&d| cap_dry(d)).unwrap_or(0.0)
        };
        let (head, tail) = (overhang(false), overhang(true));
        if wet.is_empty() && head == 0.0 && tail == 0.0 { first.push(Some(streets.len())); streets.push(s); continue; }
        let wide = s.widths.iter().copied().fold(1.0, f64::max);
        let setback = 0.5 * wide + 0.5;
        let junctions: Vec<f64> = (0..n).filter(|&i| is_shared(i)).map(|i| stations[i]).collect();
        // Point and width at a station; an original vertex is returned as it is.
        let at = |t: f64| -> (Point, f64) {
            let i = stations.partition_point(|&v| v < t - 1e-9).min(n - 1);
            if i == 0 || (stations[i] - t).abs() <= 1e-9 { return (s.path[i], width(&s, i)); }
            let f = ((t - stations[i - 1]) / (stations[i] - stations[i - 1]).max(1e-9)).clamp(0.0, 1.0);
            (lerp(s.path[i - 1], s.path[i], f), width(&s, i - 1) + (width(&s, i) - width(&s, i - 1)) * f)
        };
        let slice = |a: f64, b: f64| -> (Vec<Point>, Vec<f64>) {
            let (p, w) = at(a);
            let (mut path, mut widths) = (vec![p], vec![w]);
            for i in 0..n {
                if stations[i] > a + 1e-6 && stations[i] < b - 1e-6 { path.push(s.path[i]); widths.push(width(&s, i)); }
            }
            let (p, w) = at(b);
            path.push(p);
            widths.push(w);
            (path, widths)
        };
        // In path order: the sweep below clamps each cut to the end of the one before.
        let mut cuts: Vec<(f64, f64, Cut)> = vec![];
        if head > 0.0 { cuts.push((0.0, head, Cut::Trim)); }
        for (i, &(from, to)) in wet.iter().enumerate() {
            let lower = if i > 0 { wet[i - 1].1 } else { 0.0 };
            let upper = wet.get(i + 1).map_or(total, |next| next.0);
            if to - from < SEAM { continue; }
            let joint = |i: usize| anchors.contains(&key(s.path[i]));
            if to - from <= setback + ABUTMENT && (from <= EPS && joint(0) || to >= total - EPS && joint(n - 1)) { continue; }
            if reclaimed.is_some_and(|ground| !ground.wet(at((from + to) * 0.5).0)) {
                cuts.push((from, to, Cut::Platform));
                continue;
            }
            let (a, b) = (from - ABUTMENT, to + ABUTMENT);
            let deck = !private(&s) && a >= lower && b <= upper && to - from <= max_span && {
                let (pa, pb) = (at(a).0, at(b).0);
                let straight = s.path.iter().zip(&stations).filter(|(_, t)| **t > a && **t < b).all(|(&p, _)| g::distance(p, pa, pb).0 < 0.5);
                let chord = if straight && !surface.wet(pa) && !surface.wet(pb) { routing::water_intervals(surface, pa, pb) } else { vec![] };
                chord.len() == 1
                    && crossings::deck(surface, lerp(pa, pb, (chord[0].0 + chord[0].1) * 0.5)).is_some_and(|ends| {
                        let (length, across) = (distance(pa, pb), distance(ends[0], ends[1]));
                        let cosine = ((pb.x - pa.x) * (ends[1].x - ends[0].x) + (pb.y - pa.y) * (ends[1].y - ends[0].y)).abs() / (length * across).max(1e-9);
                        cosine >= 15.0_f64.to_radians().cos() && length <= across + 4.0
                    })
                    && deck_landing_grade(surface, [pa, pb]) <= max_grade + 1e-6
                    && !decks.any_within(lerp(pa, pb, 0.5), crossings::street_spacing(to - from, population))
                    && !meets(&[pa, pb], s.widths.iter().copied().fold(1.0, f64::max), &laid, surface)
            };
            if deck {
                decks.push(lerp(at(a).0, at(b).0, 0.5));
                laid.push(Street { path: vec![at(a).0, at(b).0], widths: vec![s.widths.iter().copied().fold(1.0, f64::max); 2], rank: s.rank, role: "bridge".into() });
                cuts.push((a, b, Cut::Deck));
                continue;
            }
            let (mut a, mut b) = ((from - setback).max(0.0), (to + setback).min(total));
            // The street ends at a junction lying between the cut and the water.
            if let Some(j) = junctions.iter().copied().filter(|&j| j > a && j <= from && j >= lower).reduce(f64::max) { a = j; }
            if let Some(j) = junctions.iter().copied().filter(|&j| j < b && j >= to && j <= upper).reduce(f64::min) { b = j; }
            cuts.push((a, b, Cut::Trim));
        }
        if tail > 0.0 { cuts.push((total - tail, total, Cut::Trim)); }
        if cuts.is_empty() { first.push(Some(streets.len())); streets.push(s); continue; }
        changed = true;
        // A setback never eats into a deck or a platform beside it.
        for i in 0..cuts.len() {
            if cuts[i].2 != Cut::Trim { continue; }
            let before = cuts[..i].iter().rev().find(|c| c.2 != Cut::Trim).map(|c| c.1);
            let after = cuts[i + 1..].iter().find(|c| c.2 != Cut::Trim).map(|c| c.0);
            if let Some(limit) = before { cuts[i].0 = cuts[i].0.max(limit); cuts[i].1 = cuts[i].1.max(limit); }
            if let Some(limit) = after { cuts[i].1 = cuts[i].1.min(limit); cuts[i].0 = cuts[i].0.min(limit); }
        }
        // A dry piece between two cuts; `cut_a`/`cut_b`: that end was cut, not joined.
        let dry = |out: &mut Vec<Street>, mut a: f64, mut b: f64, cut_a: bool, cut_b: bool| {
            let inside: Vec<f64> = junctions.iter().copied().filter(|&j| j >= a - 1e-6 && j <= b + 1e-6).collect();
            if inside.is_empty() && (cut_a && cut_b || (cut_a || cut_b) && b - a < STUB) { return; }
            if cut_b && let Some(&j) = inside.last() && b - j < STUB { b = j; }
            if cut_a && let Some(&j) = inside.first() && j - a < STUB { a = j; }
            if b - a <= 1e-6 { return; }
            let (path, widths) = slice(a, b);
            out.push(Street { path, widths, rank: s.rank, role: s.role.clone() });
        };
        let index = streets.len();
        let (mut cursor, mut cut) = (0.0, false);
        for &(a, b, kind) in &cuts {
            let a = a.max(cursor);
            let b = b.max(a);
            if a > cursor + 1e-6 { dry(&mut *streets, cursor, a, cut, kind == Cut::Trim); }
            match kind {
                Cut::Trim => {}
                Cut::Deck => {
                    let role = if b - a - 2.0 * ABUTMENT <= ford { "ford" } else { "bridge" };
                    streets.push(Street { path: vec![at(a).0, at(b).0], widths: vec![wide; 2], rank: s.rank, role: role.into() });
                }
                Cut::Platform if b - a > 1e-6 => {
                    // `StiltGround::walkways`: a regional way stands on a pier, a street on a boardwalk.
                    let regional = s.rank == 0 || matches!(s.role.as_str(), "regional" | "road" | "outbound");
                    let (path, widths) = slice(a, b);
                    let widths: Vec<f64> = widths.into_iter().map(|w| if regional { w } else { w.min(3.0) }).collect();
                    streets.push(Street { path, widths, rank: s.rank, role: (if regional { "pier" } else { "boardwalk" }).into() });
                }
                Cut::Platform => {}
            }
            cursor = b;
            cut = kind == Cut::Trim;
        }
        if total > cursor + 1e-6 { dry(&mut *streets, cursor, total, cut, false); }
        first.push((streets.len() > index).then_some(index));
    }
    changed.then_some(first)
}
