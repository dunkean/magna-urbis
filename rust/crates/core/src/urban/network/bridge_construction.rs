//! Fit decks and dry approaches to wet street runs and link occupied banks.

use super::analysis::Graph;
use super::junctions::planarize;
use super::spatial::{BoxGrid, EPS, Key, distance, key, lerp, segment_box};
use super::street::width;
use crate::urban::{Point, Street, Surface, profile::Lap};
use std::collections::{BTreeMap, BTreeSet};

/// Wet runs are crossing candidates. Apply before importing roads and after
/// the last trim: bank snapping and waterfront joints can introduce wet metres.
/// Nearby parallel decks share dry approaches on each bank, never a wet link.
pub(in crate::urban) fn bridge_water(streets: &mut Vec<Street>, surface: Surface<'_>, max_grade: f64) {
    bridge_water_inner(streets, surface, None, max_grade);
}
pub(in crate::urban) fn bridge_water_on_ground<'a>(streets: &mut Vec<Street>, surface: Surface<'a>, physical: Surface<'a>, max_grade: f64) {
    bridge_water_inner(streets, surface, Some(physical), max_grade);
}
/// Steepest grade over the dry stretches of a deck (its two landing ramps).
pub(super) fn deck_landing_grade(surface: Surface<'_>, ends: [Point; 2]) -> f64 {
    let steps = (distance(ends[0], ends[1]) / 2.0).ceil().max(1.0) as usize;
    let at = |i: usize| lerp(ends[0], ends[1], i as f64 / steps as f64);
    (0..steps).filter(|&i| !surface.wet(at(i)) && !surface.wet(at(i + 1)))
        .map(|i| (surface.height_at(at(i + 1)) - surface.height_at(at(i))).abs() / distance(at(i), at(i + 1)).max(1e-9))
        .fold(0.0, f64::max)
}
/// A deck at `middle`, moved along the channel when its landing ramps exceed the
/// street grade limit; the original when no admissible site lies within 150 m.
fn deck_on_grade(surface: Surface<'_>, middle: Point, max_grade: f64) -> Option<[Point; 2]> {
    let first = crate::urban::footprint::crossings::deck(surface, middle)?;
    if deck_landing_grade(surface, first) <= max_grade + 1e-6 { return Some(first); }
    let len = distance(first[0], first[1]).max(1e-9);
    let u = ((first[1].x - first[0].x) / len, (first[1].y - first[0].y) / len);
    for offset in [12.0, -12.0, 24.0, -24.0, 48.0, -48.0, 72.0, -72.0, 96.0, -96.0, 144.0, -144.0] {
        let p = Point { x: middle.x - u.1 * offset, y: middle.y + u.0 * offset };
        if let Some(c) = crate::urban::footprint::crossings::deck(surface, p)
            && deck_landing_grade(surface, c) <= max_grade + 1e-6 { return Some(c); }
    }
    Some(first)
}
fn bridge_water_inner<'a>(streets: &mut Vec<Street>, surface: Surface<'a>, physical: Option<Surface<'a>>, max_grade: f64) {
    let _profile = crate::urban::routing::Profile::new("bridge_water");
    #[cfg(test)]
    if let Some(dir) = std::env::var_os("BRIDGE_CAPTURE") {
        thread_local! { static PASS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
        let pass = PASS.with(|p| { let i = p.get(); p.set(i + 1); i });
        std::fs::write(std::path::Path::new(&dir).join(format!("streets-{pass}.json")), serde_json::to_vec(streets).unwrap()).unwrap();
    }
    use crate::urban::{footprint::crossings, geometry as g, routing};
    struct Request<'a> { a: Point, b: Point, middle: Point, width: f64, rank: usize, path: Vec<Point>, retain: bool, crossing: bool, causeway: bool, surface: Surface<'a> }
    let mut requests = vec![];
    let mut dry = vec![];
    let ground = surface;
    let mut junctions: BTreeMap<Key, usize> = BTreeMap::new();
    for s in streets.iter() { for &p in &s.path { *junctions.entry(key(p)).or_default() += 1; } }
    let mut laps = Lap::new("bridge_water");
    let mut bank_junctions = BTreeSet::new();
    if let Some(physical) = physical {
        // Per-street probes are independent; the set does not depend on their order.
        let probed: Vec<&Street> = streets.iter().filter(|s| !matches!(s.role.as_str(), "pier" | "mole" | "landing")).collect();
        let joints = crate::urban::par::map(&probed, |_, s| {
            let mut found = vec![];
            for w in s.path.windows(2) {
                for (p, q) in [(w[0], w[1]), (w[1], w[0])] {
                    // A vector/raster seam can leave the shore joint just wet.
                    let inside = lerp(p, q, (1.0 / distance(p, q).max(EPS)).min(0.5));
                    if routing::segment_clear(physical, inside, q, f64::INFINITY) { found.push(key(p)); }
                }
            }
            found
        });
        bank_junctions.extend(joints.into_iter().flatten());
    }
    laps.lap("bank_junctions");
    let waterfront: Vec<_> = streets.iter().filter(|s| s.role == "quay").flat_map(|s|
        s.path.windows(2).map(|w| (w[0], w[1], s.widths.iter().copied().fold(1.0, f64::max) * 0.5 + 0.5))).collect();
    // Waterfront segments by their box grown by their half width.
    let waterfront_grid = BoxGrid::new(&waterfront.iter().map(|&(a, b, width)| segment_box(a, b, width)).collect::<Vec<_>>(), 32.0);
    let old = std::mem::take(streets);
    // The wet runs of every street are independent reads of the surface: measured
    // in parallel with the role the loop below gives it, used in street order.
    let runs = crate::urban::par::map(&old, |_, s| {
        let bridge = s.role == "bridge"
            || s.role == "pier" && s.path.len() >= 2 && [s.path[0], *s.path.last().unwrap()].iter().all(|p| bank_junctions.contains(&key(*p)));
        if s.path.len() < 2 || !bridge && matches!(s.role.as_str(), "quay" | "pier" | "mole" | "landing") { return None; }
        let surface = if bridge { physical.unwrap_or(surface) } else { surface };
        let mut stations = vec![0.0];
        let mut wet: Vec<(f64, f64)> = vec![];
        for w in s.path.windows(2) {
            let start = *stations.last().unwrap(); let len = distance(w[0], w[1]);
            for (a, b) in routing::water_intervals(surface, w[0], w[1]) {
                let (a, b) = (start + a * len, start + b * len);
                if let Some(last) = wet.last_mut().filter(|last| a - last.1 < 0.01) { last.1 = b; }
                else { wet.push((a, b)); }
            }
            stations.push(start + len);
        }
        Some((stations, wet))
    });
    laps.lap("runs");
    for (mut s, run) in old.into_iter().zip(runs) {
        // A stilt walkway returning to streets on both physical banks is a
        // crossing, even when reclaimed shallows hid the river during planning.
        if s.role == "pier" && s.path.len() >= 2 && [s.path[0], *s.path.last().unwrap()].iter().all(|p| bank_junctions.contains(&key(*p))) {
            s.role = "bridge".into();
        }
        // Built waterfront platforms have their own support geometry.
        if s.path.len() < 2 || matches!(s.role.as_str(), "quay" | "pier" | "mole" | "landing") {
            dry.push(s); continue;
        }
        let surface = if s.role == "bridge" { physical.unwrap_or(surface) } else { surface };
        let (stations, wet) = run.expect("a street that reaches the wet runs was measured");
        if wet.is_empty() {
            if s.role == "bridge" && physical.is_some() { s.role = "approach".into(); }
            dry.push(s); continue;
        }
        let total = *stations.last().unwrap();
        let retain = s.role == "bridge" && wet.len() == 1 && !surface.wet(s.path[0]) && !surface.wet(*s.path.last().unwrap())
            && s.path.iter().all(|&p| g::distance(p, s.path[0], *s.path.last().unwrap()).0 < 0.05);
        let at = |t: f64| {
            let i = stations.partition_point(|&v| v < t).clamp(1, stations.len() - 1);
            lerp(s.path[i - 1], s.path[i], (t - stations[i - 1]) / (stations[i] - stations[i - 1]).max(1e-9))
        };
        let slice = |a: f64, b: f64| {
            let mut path = vec![at(a)];
            path.extend(s.path.iter().zip(&stations).filter(|(_, t)| **t > a + EPS && **t < b - EPS).map(|(&p, _)| p));
            path.push(at(b)); path
        };
        let role = if matches!(s.role.as_str(), "bridge" | "ford" | "causeway") { "approach" } else { &s.role };
        let w = s.widths.iter().copied().fold(1.0, f64::max);
        let mut cursor = 0.0;
        for (i, &(from, to)) in wet.iter().enumerate() {
            let landing = (surface.width / surface.n as f64 * 6.0).clamp(2.0, 45.0).min(((to - from) * 0.5).max(2.0));
            let next = wet.get(i + 1).map_or(total, |next| (to + next.0) * 0.5);
            let mut a = if retain { 0.0 } else { (from - landing).max(cursor) };
            let mut b = if retain { total } else { (to + landing).min(next) };
            if !retain {
                let step = (surface.width / surface.n as f64 * 0.5).clamp(1.0, 4.0);
                let radius = (step * 0.5).min(1.0);
                let land = |p: Point| [(0.0, 0.0), (radius, 0.0), (-radius, 0.0), (0.0, radius), (0.0, -radius)].iter()
                    .all(|&(x, y)| !surface.wet(Point { x: p.x + x, y: p.y + y }));
                while a > cursor.max(from - 200.0) && (!land(at(a)) || !routing::segment_clear(surface, at((a - step).max(cursor)), at(a), max_grade)) { a = (a - step).max(cursor); }
                while b < next.min(to + 200.0) && (!land(at(b)) || !routing::segment_clear(surface, at(b), at((b + step).min(next)), max_grade)) { b = (b + step).min(next); }
            }
            if a > cursor + EPS { let path = slice(cursor, a);
                dry.push(Street { widths: vec![w; path.len()], path, rank: s.rank, role: role.into() });
            }
            requests.push(Request { a: at(a), b: at(b), middle: at((from + to) * 0.5), width: w, rank: s.rank, path: slice(a, b), retain, crossing: s.role == "bridge", causeway: s.role == "causeway", surface });
            cursor = b;
        }
        if cursor < total - EPS { let path = slice(cursor, total);
            dry.push(Street { widths: vec![w; path.len()], path, rank: s.rank, role: role.into() });
        }
    }
    laps.lap("split");
    if requests.is_empty() { *streets = dry; return; }
    requests.sort_by(|a, b| a.rank.cmp(&b.rank).then_with(|| b.width.total_cmp(&a.width)));
    let mut decks: Vec<Street> = vec![];
    let approach_uncached = |surface: Surface<'_>, a: Point, b: Point, local: bool| -> Option<Vec<Point>> {
        if distance(a, b) < 0.05 { return Some(vec![]); }
        if surface.wet(a) { return None; }
        if routing::segment_clear(surface, a, b, max_grade) { return Some(vec![a, b]); }
        if routing::segment_clear(surface, a, b, f64::INFINITY) { return Some(vec![a, b]); }
        // A local crossing joins nearby streets; it does not invent a long
        // bank road to make a difficult landing work.
        if local && distance(a, b) > 120.0 { return None; }
        for (margin, fine) in [(30.0, false), (30.0, true), (150.0, true)] {
            if local && fine { continue; }
            let bounds = (a.x.min(b.x) - margin, a.y.min(b.y) - margin, a.x.max(b.x) + margin, a.y.max(b.y) + margin);
            let mut planner = if fine { routing::RoutePlanner::bank(surface, bounds) } else { routing::RoutePlanner::new(surface, bounds) };
            if let Some(path) = planner.route(a, b, max_grade) { return Some(path); }
        }
        // A raised bank approach carries the road above a steep bed edge.
        // It still stays on this bank; its causeway record provides support.
        let margin = if local { 30.0 } else { 150.0 };
        let mut planner = routing::RoutePlanner::bank(surface, (a.x.min(b.x) - margin, a.y.min(b.y) - margin, a.x.max(b.x) + margin, a.y.max(b.y) + margin));
        if !local && let Some(path) = planner.route(a, b, 1e6) { return Some(path); }
        let mut planner = routing::RoutePlanner::raised_bank(surface, (a.x.min(b.x) - margin, a.y.min(b.y) - margin, a.x.max(b.x) + margin, a.y.max(b.y) + margin));
        planner.route(a, b, 1e6)
    };
    // Alternate deck positions and nearby segment projections revisit the same
    // ramps. Cache failures as well as paths, on this exact planning surface.
    let approach_cache = std::cell::RefCell::new(std::collections::HashMap::<_, Option<Vec<Point>>>::new());
    let approach = |surface: Surface<'_>, a: Point, b: Point, local: bool| -> Option<Vec<Point>> {
        let k = (surface.geometry.map_or(0, |g| g as *const _ as usize),
            surface.height.as_ptr() as usize, surface.water.as_ptr() as usize, surface.n, surface.width.to_bits(),
            a.x.to_bits(), a.y.to_bits(), b.x.to_bits(), b.y.to_bits(), local);
        if let Some(path) = approach_cache.borrow().get(&k) { return path.clone(); }
        let path = approach_uncached(surface, a, b, local);
        approach_cache.borrow_mut().insert(k, path.clone());
        path
    };
    let bank_street = |surface: Surface<'_>, path: Vec<Point>, width: f64, rank: usize| {
        let role = if routing::path_clear(surface, &path, max_grade) { "approach" } else { "causeway" };
        Street { widths: vec![width; path.len()], path, rank, role: role.into() }
    };
    // Old deck records can contain long dry approaches and their junctions.
    // Keep that bank network available while choosing the shorter wet span.
    for r in &requests { for w in r.path.windows(2) {
        let mut cursor = 0.0;
        for (a, b) in routing::water_intervals(r.surface, w[0], w[1]).into_iter().chain(std::iter::once((1.0, 1.0))) {
            if a - cursor > 1e-6 {
                let (mut p, mut q) = (lerp(w[0], w[1], cursor), lerp(w[0], w[1], a));
                let step = (r.surface.width / r.surface.n as f64 * 0.5).clamp(0.5, 2.0);
                for _ in 0..24 {
                    let length = distance(p, q);
                    if length <= step * 2.0 { break; }
                    let (next, before) = (lerp(p, q, step / length), lerp(q, p, step / length));
                    let trim_start = !routing::segment_clear(r.surface, p, next, max_grade);
                    let trim_end = !routing::segment_clear(r.surface, before, q, max_grade);
                    if !trim_start && !trim_end { break; }
                    if trim_start { p = next; } if trim_end { q = before; }
                }
                if routing::segment_clear(r.surface, p, q, max_grade) {
                    dry.push(bank_street(r.surface, vec![p, q], r.width, r.rank));
                }
            }
            cursor = b;
        }
    }}
    laps.lap("trim_ramps");
    let bank_segments: Vec<_> = dry.iter().filter(|s| !matches!(s.role.as_str(), "pier" | "mole" | "landing"))
        .flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1]))).collect();
    let bank_graph = Graph::new(&dry);
    let bank_grid = BoxGrid::new(&bank_segments.iter().map(|&(a, b)| segment_box(a, b, 0.0)).collect::<Vec<_>>(), 64.0);
    let ramps = |r: &Request<'_>, ends: [Point; 2]| -> Option<Vec<Vec<Point>>> {
        // Deck axis, pointing outwards from each landing.
        let span = distance(ends[0], ends[1]).max(1e-9);
        let axis = Point { x: (ends[0].x - ends[1].x) / span, y: (ends[0].y - ends[1].y) / span };
        let joint = |p: Point, end: Point, out: Point| -> Option<Vec<Point>> {
            if distance(p, end) < 0.05 { return Some(vec![]); }
            // A street meeting a square deck at an angle runs straight off the
            // deck first, then turns: the bend sits on land, not on the abutment.
            let lead = (2.5 * r.width).clamp(4.0, 15.0);
            let (dx, dy) = (p.x - end.x, p.y - end.y);
            let along = dx * out.x + dy * out.y;
            if along > 1.5 * lead && (dx * out.y - dy * out.x).abs() > 0.2 * along {
                let knee = Point { x: end.x + out.x * lead, y: end.y + out.y * lead };
                if !r.surface.wet(knee) && routing::segment_clear(r.surface, knee, end, max_grade)
                    && routing::segment_clear(r.surface, p, knee, max_grade) { return Some(vec![p, knee, end]); }
            }
            if routing::segment_clear(r.surface, p, end, max_grade) { return Some(vec![p, end]); }
            // A clipped bank tip need not be the junction: use an existing
            // street on this bank and let planarization share the new point.
            // Only the segments within 200 m of `end` qualify, kept in segment order.
            let mut nearby: Vec<_> = bank_grid.query(end.x - 200.0, end.y - 200.0, end.x + 200.0, end.y + 200.0).into_iter().filter_map(|k| {
                let (a, b) = bank_segments[k];
                let (d, _, q) = g::distance(end, a, b);
                (d < 200.0 && distance(p, q) < distance(p, end) + 80.0 && !r.surface.wet(q))
                    .then_some((d + distance(p, q) * 0.25, q, a, b))
            }).collect();
            nearby.sort_by(|a, b| a.0.total_cmp(&b.0));
            // Use streets already connected on this bank before searching a
            // long new detour from the old oblique crossing's landing.
            for &(_, q, a, _) in nearby.iter().take(12) {
                if !routing::segment_clear(r.surface, q, end, f64::INFINITY) { continue; }
                let joined = bank_graph.component.get(&key(p)).is_some_and(|c| bank_graph.component.get(&key(a)) == Some(c));
                if joined { return Some(vec![q, end]); }
                if routing::segment_clear(r.surface, p, q, f64::INFINITY) { return Some(vec![p, q, end]); }
            }
            if let Some(path) = approach(r.surface, p, end, r.rank > 1) { return Some(path); }
            for (_, q, a, b) in nearby.into_iter().take(12) {
                if [a, b].iter().any(|&p| routing::segment_clear(r.surface, q, p, f64::INFINITY))
                    && let Some(path) = approach(r.surface, q, end, r.rank > 1) { return Some(path); }
            }
            None
        };
        let back = Point { x: -axis.x, y: -axis.y };
        let mut paths = vec![joint(r.a, ends[0], axis)?, joint(r.b, ends[1], back)?];
        // Bank ramps may swallow a quay/street junction between the old
        // landing and the water. Keep its identity and attach it on land.
        for (i, &p) in r.path.iter().enumerate() {
            if p == r.a || p == r.b || r.surface.wet(p) || junctions.get(&key(p)).copied().unwrap_or(0) < 2 { continue; }
            let before = &r.path[..=i]; let after = &r.path[i..];
            if routing::path_clear(r.surface, before, f64::INFINITY) { paths.push(before.to_vec()); continue; }
            if routing::path_clear(r.surface, after, f64::INFINITY) { paths.push(after.to_vec()); continue; }
            let end = if distance(p, ends[0]) < distance(p, ends[1]) { ends[0] } else { ends[1] };
            paths.push(approach(r.surface, p, end, r.rank > 1)?);
        }
        Some(paths)
    };
    for r in requests {
        let surface = r.surface;
        // Reclaimed/stilt ground changes where streets can stand, not the
        // river's flow. Fit every deck against the physical channel.
        let channel_surface = physical.unwrap_or(surface);
        let supported = |p: Point| !surface.wet(p)
            || (!r.crossing && physical.is_some() && !ground.wet(p))
            || waterfront_grid.query(p.x, p.y, p.x, p.y).into_iter().any(|k| { let (a, b, width) = waterfront[k]; g::distance(p, a, b).0 <= width });
        let on_platform = r.path.windows(2).all(|w| {
            let steps = (distance(w[0], w[1]) / 1.0).ceil().max(1.0) as usize;
            (0..=steps).all(|i| { let p = lerp(w[0], w[1], i as f64 / steps as f64);
                supported(p)
            })
        });
        if on_platform {
            // A supported quay joint is a causeway, not a second quay branch.
            decks.push(Street { widths: vec![r.width; r.path.len()], path: r.path, rank: r.rank, role: "causeway".into() });
            continue;
        }
        // A deck spans running water only. A causeway culture's raised road
        // over a lake or the sea stays the causeway it was routed as.
        if r.causeway && r.path.windows(2).any(|w| crossings::over_still_water(channel_surface, w[0], w[1])) {
            decks.push(Street { widths: vec![r.width; r.path.len()], path: r.path, rank: r.rank, role: "causeway".into() });
            continue;
        }
        let middle = if surface.wet(r.middle) { r.middle } else {
            r.path.windows(2).flat_map(|w| routing::water_intervals(surface, w[0], w[1]).into_iter().map(move |(a, b)|
                ((b - a) * distance(w[0], w[1]), lerp(w[0], w[1], (a + b) * 0.5))))
                .max_by(|a, b| a.0.total_cmp(&b.0)).map_or(r.middle, |v| v.1)
        };
        let Some(mut ends) = crossings::deck(channel_surface, middle) else {
            #[cfg(test)]
            if std::env::var_os("BRIDGE_TRACE").is_some() { eprintln!("bridge/no-banks {:?} {:?}, middle {middle:?}", r.a, r.b); }
            if let Some(path) = approach(surface, r.a, r.b, r.rank > 1).filter(|p| p.len() >= 2) { dry.push(bank_street(surface, path, r.width, r.rank)); }
            continue;
        };
        if distance(r.a, ends[0]) > distance(r.a, ends[1]) { ends.swap(0, 1); }
        if r.retain {
            let (dx, dy) = (r.b.x - r.a.x, r.b.y - r.a.y);
            let cosine = (dx * (ends[1].x - ends[0].x) + dy * (ends[1].y - ends[0].y)).abs() / (distance(r.a, r.b) * distance(ends[0], ends[1])).max(1e-9);
            if cosine >= 15.0_f64.to_radians().cos() && distance(r.a, r.b) <= distance(ends[0], ends[1]) + 4.0 { ends = [r.a, r.b]; }
        }
        let length = distance(ends[0], ends[1]);
        let u = ((ends[1].x - ends[0].x) / length, (ends[1].y - ends[0].y) / length);
        let mid = lerp(ends[0], ends[1], 0.5);
        let channel = routing::water_intervals(surface, ends[0], ends[1]).into_iter()
            .max_by(|a, b| (a.1 - a.0).total_cmp(&(b.1 - b.0)))
            .map_or(mid, |(a, b)| lerp(ends[0], ends[1], (a + b) * 0.5));
        let side = |p: Point| (p.x - channel.x) * u.0 + (p.y - channel.y) * u.1;
        // A chord clipping a bend can enter water and return to the same
        // bank. Keep that street on land instead of bridging along the flow.
        if !surface.wet(r.a) && !surface.wet(r.b) && side(r.a) * side(r.b) > 0.0 {
            let path = approach(surface, r.a, r.b, r.rank > 1).or_else(|| {
                let margin = 150.0;
                let mut planner = routing::RoutePlanner::new(surface, (r.a.x.min(r.b.x) - margin, r.a.y.min(r.b.y) - margin, r.a.x.max(r.b.x) + margin, r.a.y.max(r.b.y) + margin));
                planner.route(r.a, r.b, max_grade)
            });
            if let Some(path) = path {
                for &p in &r.path {
                    if surface.wet(p) || junctions.get(&key(p)).copied().unwrap_or(0) < 2 { continue; }
                    let Some((_, _, target)) = path.windows(2).map(|w| g::distance(p, w[0], w[1])).min_by(|a, b| a.0.total_cmp(&b.0)) else { continue; };
                    if let Some(branch) = approach(surface, p, target, r.rank > 1).filter(|p| p.len() >= 2) {
                        dry.push(bank_street(surface, branch, r.width, r.rank));
                    }
                }
                if path.len() >= 2 { dry.push(bank_street(surface, path, r.width, r.rank)); }
                continue;
            }
            // No buildable shortcut on this bank: retain its dry approaches,
            // rather than inventing a deck that runs along the watercourse.
            for w in r.path.windows(2) {
                let mut cursor = 0.0;
                for (a, b) in routing::water_intervals(surface, w[0], w[1]).into_iter().chain(std::iter::once((1.0, 1.0))) {
                    if a - cursor > 1e-6 {
                        let path = vec![lerp(w[0], w[1], cursor), lerp(w[0], w[1], a)];
                        dry.push(Street { widths: vec![r.width; 2], path, rank: r.rank, role: "approach".into() });
                    }
                    cursor = b;
                }
            }
            continue;
        }
        // A landing ramp steeper than the street grade limit is not a site: look
        // along the channel for one whose two ramps respect it.
        let steep = |e: [Point; 2]| deck_landing_grade(channel_surface, e) > max_grade + 1e-6;
        let mut own_paths = if steep(ends) { None } else { ramps(&r, ends) };
        if own_paths.is_none() {
            ends.swap(0, 1); own_paths = if steep(ends) { None } else { ramps(&r, ends) };
            if own_paths.is_none() { ends.swap(0, 1); }
        }
        if own_paths.is_none() {
            // Move a perpendicular span along the channel until both landings
            // admit ramps. The road turns on land, never on the deck.
            for offset in [12.0, -12.0, 24.0, -24.0, 48.0, -48.0, 72.0, -72.0, 96.0, -96.0, 144.0, -144.0] {
                let p = Point { x: middle.x - u.1 * offset, y: middle.y + u.0 * offset };
                let Some(mut candidate) = crossings::deck(channel_surface, p) else { continue; };
                if steep(candidate) { continue; }
                if distance(r.a, candidate[0]) > distance(r.a, candidate[1]) { candidate.swap(0, 1); }
                let mut paths = ramps(&r, candidate);
                if paths.is_none() { candidate.swap(0, 1); paths = ramps(&r, candidate); }
                if let Some(paths) = paths { ends = candidate; own_paths = Some(paths); break; }
            }
        }
        // No admissible site nearby: keep the original crossing, however steep.
        if own_paths.is_none() && steep(ends) {
            own_paths = ramps(&r, ends);
            if own_paths.is_none() { ends.swap(0, 1); own_paths = ramps(&r, ends); if own_paths.is_none() { ends.swap(0, 1); } }
        }
        let length = distance(ends[0], ends[1]);
        let u = ((ends[1].x - ends[0].x) / length, (ends[1].y - ends[0].y) / length);
        let mid = lerp(ends[0], ends[1], 0.5);
        let mut merged = false;
        for d in &mut decks {
            if d.role != "bridge" { continue; }
            let (a, b) = (d.path[0], *d.path.last().unwrap());
            let len = distance(a, b); let v = ((b.x - a.x) / len, (b.y - a.y) / len);
            let other = lerp(a, b, 0.5);
            if (u.0 * v.0 + u.1 * v.1).abs() < 15.0_f64.to_radians().cos()
                || distance(mid, other) > (30.0 + 2.0 * length.max(len)).min(200.0)
                || !(1..4).all(|k| surface.wet(lerp(mid, other, k as f64 / 4.0))) { continue; }
            let mut target = if distance(r.a, a) < distance(r.a, b) { [a, b] } else { [b, a] };
            if [r.a, r.b].iter().any(|&p| surface.wet(p) && g::distance(p, a, b).0 > 0.05) { continue; }
            let mut paths = ramps(&r, target);
            if paths.is_none() { target.swap(0, 1); paths = ramps(&r, target); }
            let Some(paths) = paths else { continue; };
            for path in paths.into_iter().filter(|p| p.len() >= 2) {
                dry.push(bank_street(surface, path, r.width, r.rank));
            }
            for w in &mut d.widths { *w = w.max(r.width); }
            merged = true; break;
        }
        if merged { continue; }
        let paths = own_paths;
        // A crossing needs both ramps; an isolated deck serves neither bank.
        if paths.is_none() {
            #[cfg(test)]
            if std::env::var_os("BRIDGE_TRACE").is_some() { eprintln!("bridge/no-ramps {:?} {:?}, deck {ends:?}, wet={}/{}", r.a, r.b, surface.wet(r.a), surface.wet(r.b)); }
            for (a, b) in [(r.a, ends[0]), (r.b, ends[1])] {
                if let Some(path) = approach(surface, a, b, r.rank > 1).filter(|p| p.len() >= 2) { dry.push(bank_street(surface, path, r.width, r.rank)); }
            }
            continue;
        }
        for path in paths.unwrap().into_iter().filter(|p| p.len() >= 2) {
            dry.push(bank_street(surface, path, r.width, r.rank));
        }
        decks.push(Street { path: ends.to_vec(), widths: vec![r.width; 2], rank: r.rank, role: "bridge".into() });
    }
    laps.lap("requests");
    dry.extend(decks); *streets = dry;
    planarize(streets, surface.width * 0.25);
    laps.lap("planarize");
}

/// Supply missing crossings from occupied bank streets, including towns whose
/// original roads never crossed water. Both ramps must reach existing streets
/// entirely on land; no routing search or isolated landing is introduced.
pub(super) fn built_bank_crossings(streets: &mut Vec<Street>, land: &[Street], banks: &Graph, served: &[bool], surface: Surface<'_>, max_grade: f64, joined: Option<&[usize]>) -> bool {
    use crate::urban::{geometry as g, routing};
    struct Sample { p: Point, a: Point, b: Point, rank: usize, width: f64, bank: usize }
    let mut laps = Lap::new("bank_crossings");
    let mut samples = vec![];
    let mut sampled = BTreeSet::new();
    let mut order: Vec<_> = land.iter().collect();
    order.sort_by_key(|s| s.rank);
    for s in order {
        if matches!(s.role.as_str(), "track" | "pier" | "mole" | "landing") { continue; }
        let Some(&bank) = s.path.first().and_then(|p| banks.component.get(&key(*p))).filter(|&&c| served[c]) else { continue; };
        let bank = joined.map_or(bank, |j| j[bank]);
        for w in s.path.windows(2) {
            let n = (distance(w[0], w[1]) / 40.0).ceil().max(1.0) as usize;
            for i in 0..=n {
                let p = lerp(w[0], w[1], i as f64 / n as f64);
                if !surface.wet(p) && sampled.insert(key(p)) { samples.push(Sample { p, a: w[0], b: w[1], rank: s.rank, width: width(s, 0), bank }); }
            }
        }
    }
    laps.lap("samples");
    let bin = |p: Point, size: f64| ((p.x / size).floor() as i64, (p.y / size).floor() as i64);
    let pair = |a: usize, b: usize| (a.min(b), a.max(b));
    // Samples of each 200 m bin in index order, with the fields the pair scan
    // reads kept together (position, bank): it visits the neighbouring bins of
    // every sample, so the scan reads contiguous slots, not the whole samples.
    struct Slot { j: usize, x: f64, y: f64, bank: usize }
    let mut index: std::collections::HashMap<(i64, i64), Vec<Slot>> = Default::default();
    for (i, s) in samples.iter().enumerate() { index.entry(bin(s.p, 200.0)).or_default().push(Slot { j: i, x: s.p.x, y: s.p.y, bank: s.bank }); }
    // Candidate pairs in scan order (sample, then neighbouring bins, then
    // index), each with its bucket: the 40 m bin of its midpoint and its bank
    // pair. A bucket keeps the four best accepted pairs (lowest score, then
    // scan order), so the samples are cut into runs, each run keeps its own
    // four per bucket as it scans, and the runs' lists merge in run order: the
    // union holds the four best of the whole scan, whatever the thread count.
    type Kept = (f64, usize, usize, usize);
    let run = samples.len().div_ceil(crate::urban::par::threads().max(1) * 16).max(1);
    let runs: Vec<(usize, usize)> = (0..samples.len()).step_by(run).map(|lo| (lo, (lo + run).min(samples.len()))).collect();
    let kept = crate::urban::par::map(&runs, |_, &(lo, hi)| {
        let mut buckets: std::collections::HashMap<((i64, i64), (usize, usize)), Vec<Kept>> = Default::default();
        for i in lo..hi {
            let a = &samples[i];
            let (x, y) = bin(a.p, 200.0);
            let mut seq = 0usize;
            // Only nearby opposing banks matter. Buckets bound the pair search
            // independently of the town's total street count.
            for x in x-2..=x+2 { for y in y-2..=y+2 {
                let Some(slots) = index.get(&(x, y)) else { continue; };
                for b in &slots[slots.partition_point(|b| b.j <= i)..] {
                    // Squared distance far outside 8..400 m: the exact length cannot enter the range.
                    let (dx, dy) = (b.x - a.p.x, b.y - a.p.y);
                    let squared = dx * dx + dy * dy;
                    if !(63.9..=160_100.0).contains(&squared) { continue; }
                    let j = b.j; let bp = Point { x: b.x, y: b.y };
                    let length = distance(a.p, bp);
                    if !(8.0..=400.0).contains(&length) { continue; }
                    // Inside one bank network a dry midpoint avoids inland pairs.
                    // Different networks may have very unequal bank setbacks.
                    // (Under a bank budget two samples of one bank never pair: no wet probe.)
                    if a.bank == b.bank && joined.is_some() { continue; }
                    let middle = lerp(a.p, bp, 0.5);
                    let wet = surface.wet(middle);
                    if a.bank == b.bank && !wet { continue; }
                    let score = a.rank.max(samples[j].rank) as f64 * 400.0 + length;
                    seq += 1;
                    let bucket = buckets.entry((bin(middle, 40.0), pair(a.bank, b.bank))).or_default();
                    // Four better or equal pairs came earlier in the scan: this one cannot be among the four best.
                    if bucket.len() == 4 && score >= bucket[3].0 { continue; }
                    if !wet && surface.geometry.map_or_else(|| routing::segment_clear(surface, a.p, bp, f64::INFINITY), |g| g.segment_dry(a.p, bp)) { continue; }
                    bucket.push((score, i, seq, j));
                    bucket.sort_by(|p, q| p.0.total_cmp(&q.0).then(p.1.cmp(&q.1)).then(p.2.cmp(&q.2))); bucket.truncate(4);
                }
            }}
        }
        buckets
    });
    laps.lap("candidates");
    let mut merged: BTreeMap<_, Vec<Kept>> = BTreeMap::new();
    for list in kept { for (bucket, found) in list { merged.entry(bucket).or_default().extend(found); } }
    let sightlines: Vec<Vec<(usize, usize, f64)>> = merged.into_values().map(|mut found| {
        found.sort_by(|p, q| p.0.total_cmp(&q.0).then(p.1.cmp(&q.1)).then(p.2.cmp(&q.2))); found.truncate(4);
        found.into_iter().map(|(score, i, _, j)| (i, j, score)).collect()
    }).collect();
    laps.lap("buckets");
    laps.lap("sightlines");
    // Exact vector/raster span measurements are only needed for this small
    // spatial shortlist, rather than for every pair of urban street samples.
    let mut probes: BTreeMap<_, Vec<(usize, usize, Point, f64)>> = BTreeMap::new();
    let sightlines: Vec<_> = sightlines.into_iter().flatten().collect();
    let spans = crate::urban::par::map(&sightlines, |_, &(i, j, _)| routing::water_intervals(surface, samples[i].p, samples[j].p));
    for (&(i, j, score), wet) in sightlines.iter().zip(spans) {
        let (a, b) = (&samples[i], &samples[j]);
        if wet.len() != 1 { continue; }
        let (lo, hi) = wet[0];
        if (hi - lo) * distance(a.p, b.p) < 2.0 { continue; }
        let middle = lerp(a.p, b.p, (lo + hi) * 0.5);
        let bucket = probes.entry((bin(middle, 80.0), pair(a.bank, b.bank))).or_default();
        bucket.push((i, j, middle, score));
        bucket.sort_by(|a, b| a.3.total_cmp(&b.3)); bucket.truncate(4);
    }
    laps.lap("spans");
    let mut added = vec![];
    let mut middles: Vec<_> = streets.iter().filter(|s| s.role == "bridge" && s.path.len() >= 2)
        .filter(|s| [s.path[0], *s.path.last().unwrap()].iter().all(|p|
            banks.component.get(&key(*p)).is_some_and(|&c| served[c])))
        .map(|s| { let bank = |p: Point| { let c = banks.component[&key(p)]; joined.map_or(c, |j| j[c]) };
            (lerp(s.path[0], *s.path.last().unwrap(), 0.5), pair(bank(s.path[0]), bank(*s.path.last().unwrap()))) }).collect();
    // Under the village budget a bank pair gets one deck, the best-scored sightline.
    let mut probes: Vec<_> = probes.into_values().flatten().collect();
    if joined.is_some() { probes.sort_by(|a, b| a.3.total_cmp(&b.3)); }
    // Reuse the stilt network if it already occupies this particular crossing.
    // Other crossings on the same river can still serve separate streets.
    let walks: Vec<_> = land.iter().filter(|s| matches!(s.role.as_str(), "boardwalk" | "walkway" | "pier"))
        .filter_map(|s| {
            let &c = banks.component.get(&key(*s.path.first()?))?;
            Some((joined.map_or(c, |j| j[c]), s))
        }).collect();
    // Deck fits and their ramps are pure per probe: measured up front (in
    // parallel); only the check against the decks already added needs the order.
    let reach = if joined.is_some() { f64::INFINITY } else { 90.0 };
    let decks = crate::urban::par::map(&probes, |_, &(i, j, middle, _)| {
        let (a, b) = (&samples[i], &samples[j]);
        // A probe beside a deck that is already there stays skipped as decks are added.
        let bank_pair = pair(a.bank, b.bank);
        if middles.iter().any(|&(m, p)| p == bank_pair && distance(m, middle) < reach) { return None; }
        let mut ends = deck_on_grade(surface, middle, max_grade)?;
        if distance(a.p, ends[0]) > distance(a.p, ends[1]) { ends.swap(0, 1); }
        // Project onto the street so each new ramp shares a real junction.
        let joints = [g::distance(ends[0], a.a, a.b).2, g::distance(ends[1], b.a, b.b).2];
        if (0..2).any(|k| distance(joints[k], ends[k]) > 200.0
            || !routing::segment_clear(surface, joints[k], ends[k], f64::INFINITY)) { return None; }
        let wet = routing::water_intervals(surface, ends[0], ends[1]);
        let &[(from, to)] = wet.as_slice() else { return None; };
        // Test the wet span, excluding its dry abutments. Both banks must already
        // be connected, and the same walkway must cover the crossing at each station.
        if a.bank == b.bank && walks.iter().any(|&(bank, walk)| bank == a.bank &&
            [0.05, 0.5, 0.95].iter().all(|t| {
                let p = lerp(ends[0], ends[1], from + (to - from) * t);
                walk.path.windows(2).enumerate().any(|(i, w)|
                    g::distance(p, w[0], w[1]).0 <= width(walk, i) * 0.5)
            })) { return None; }
        Some((ends, joints))
    });
    for ((i, j, middle, _), deck) in probes.into_iter().zip(decks) {
        let (a, b) = (&samples[i], &samples[j]);
        let bank_pair = pair(a.bank, b.bank);
        if middles.iter().any(|&(m, p)| p == bank_pair && distance(m, middle) < reach) { continue; }
        let Some((ends, joints)) = deck else { continue; };
        let width = a.width.min(b.width).clamp(3.0, 8.0);
        let rank = a.rank.max(b.rank).max(2);
        for k in 0..2 {
            if distance(joints[k], ends[k]) > 0.05 {
                added.push(Street { path: vec![joints[k], ends[k]], widths: vec![width; 2], rank, role: "approach".into() });
            }
        }
        added.push(Street { path: ends.to_vec(), widths: vec![width; 2], rank, role: "bridge".into() });
        middles.push((lerp(ends[0], ends[1], 0.5), bank_pair));
    }
    laps.lap("decks");
    if added.is_empty() { return false; }
    streets.extend(added);
    planarize(streets, surface.width * 0.25);
    laps.lap("planarize");
    true
}
