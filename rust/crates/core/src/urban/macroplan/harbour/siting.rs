//! Harbour centre selection and the land apron connecting it to the shore.

use super::*;

/// Distance from the town centre to its harbour front: the core reaches the
/// water, with land behind it.
pub(super) fn front_distance(radius: f64) -> f64 {
    (0.12 * radius).clamp(50.0, 110.0)
}

/// A port town placed inland moves to the nearest gentle shore of its sea or
/// lake (a river only when no sea or lake is in reach), its centre at
/// `front_distance` from the water on the line from its original centre.
/// Cliff shores (the 60 m strip behind the bank climbing faster than a street
/// grade) are never chosen. `None` when the town already fronts its water or none is in
/// reach (2.5 radii, at least 1 km).
pub(in super::super::super) fn sited(
    site: &Site,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
) -> Option<Site> {
    // A bridge town may embank its own river. Crossing context alone never
    // commissions a harbour or moves its foundation towards another water.
    let river_crossing = cfg.site_archetype == "bridge"
        && !cfg.programme.navigable_access
        && !cfg.programme.functions.as_ref().is_some_and(|f| f.port > 0.0);
    if !port_town(cfg) || river_crossing || cfg.fixed_sites.contains(&site.key) || surface.n < 2 || surface.wet(site.center)
        || site.population >= 3000 && parameterized(cfg) {
        return None;
    }
    let n = surface.n as i64;
    let cell = surface.width / surface.n as f64;
    let reach = front_distance(site.radius);
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let grade = if super::super::super::profiles::stairs_allowed(cfg, culture) {
        cfg.max_stair_grade
    } else {
        cfg.max_street_grade
    };
    let search = (2.5 * site.radius).max(1000.0);
    // A port is supplied from its town over land. A flat offshore island is
    // never a substitute for an inaccessible mainland coast, even if it has
    // more room. Reuse one terrain router for the shortlisted bank candidates.
    let mut approach = routing::RoutePlanner::new(surface, (site.center.x - search, site.center.y - search,
        site.center.x + search, site.center.y + search));
    let at = |p: Point| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64);
    let centre = |i: i64, j: i64| Point {
        x: (i as f64 + 0.5) * cell,
        y: (j as f64 + 0.5) * cell,
    };
    let raw = |i: i64, j: i64| surface.water[(j * n + i) as usize];
    let (ci, cj) = at(site.center);
    let r = (search / cell).ceil() as i64;
    // Nearest bank cell per water kind (sea or lake, then river).
    // Gentle bank cells per water kind (sea or lake, then river).
    let mut banks: [Vec<(f64, Point, Point)>; 2] = [vec![], vec![]];
    for j in (cj - r).max(1)..=(cj + r).min(n - 2) {
        for i in (ci - r).max(1)..=(ci + r).min(n - 2) {
            let w = raw(i, j);
            if w == 0 {
                continue;
            }
            let q = centre(i, j);
            // Cave rock (raster class 2) is no bank to move a port to.
            if surface.solid(q) {
                continue;
            }
            let d = dist(q, site.center);
            let kind = usize::from(w == 3);
            if d > search {
                continue;
            }
            // A bank: a dry 4-neighbour, land gentle behind it.
            let Some((di, dj)) = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                .into_iter()
                .find(|&(di, dj)| raw(i + di, j + dj) == 0)
            else {
                continue;
            };
            let bank = centre(i + di, j + dj);
            let inland = unit(q, bank);
            // Open water beyond the bank: a basin (40 m), or a river.
            let open = if w == 3 { NAVIGABLE } else { 40.0 };
            if !surface.wet(add(q, inland, -open)) || !surface.wet(add(q, inland, -open * 0.5)) {
                continue;
            }
            // The harbour strip (quay, landing rows: 60 m behind the bank)
            // climbs at most a street grade over every 12 m.
            let gentle = (0..5).all(|k| {
                let (a, b) = (
                    add(bank, inland, 12.0 * k as f64),
                    add(bank, inland, 12.0 * (k + 1) as f64),
                );
                !surface.wet(b)
                    && (surface.height_at(b) - surface.height_at(a)).abs()
                        <= 12.0 * cfg.max_street_grade
            });
            if !gentle {
                continue;
            }
            banks[kind].push((d, q, bank));
        }
    }
    // A harbour front is a gentle shore of some length, not a single gentle
    // cell on a cliff coast: about 80 m of gentle bank within 150 m.
    const BIN: f64 = 100.0;
    for list in banks.iter_mut() {
        let mut count: std::collections::HashMap<(i64, i64), usize> = Default::default();
        let key = |p: Point| ((p.x / BIN).floor() as i64, (p.y / BIN).floor() as i64);
        for b in list.iter() {
            *count.entry(key(b.1)).or_default() += 1;
        }
        let front = (80.0 / cell).ceil() as usize;
        list.retain(|b| {
            let (x, y) = key(b.1);
            let around: usize = (-1..=1)
                .flat_map(|dx| (-1..=1).map(move |dy| (x + dx, y + dy)))
                .map(|k| count.get(&k).copied().unwrap_or(0))
                .sum();
            around >= front
        });
    }
    let kind = if cfg.site_archetype == "bridge" && !banks[1].is_empty() { 1 } else { usize::from(banks[0].is_empty()) };
    let mut chosen = std::mem::take(&mut banks[kind]);
    if cfg.sheltered_harbour {chosen.extend(std::mem::take(&mut banks[1-kind]));}
    let mut banks = chosen;
    banks.sort_by(|a, b| a.0.total_cmp(&b.0));
    if cfg.sheltered_harbour {shelter::rank_banks(&mut banks,surface,site);}
    if std::env::var("URBAN_PROFILE").is_ok() { eprintln!("harbour banks={} nearest={:?}", banks.len(), banks.first().map(|b|b.0)); }
    // Within about a block of the water the town already fronts it.
    if banks.first().is_none_or(|b| b.0 <= reach.max(120.0)) {
        return None;
    }
    // The nearest bank whose town ground is buildable: on the line from the
    // water to the old centre, the first dry point between one and two front
    // distances whose 30 m surroundings stay within a lane grade.
    let level = |c: Point| {
        let h = surface.height_at(c);
        (0..8).all(|k| {
            let a = k as f64 * std::f64::consts::FRAC_PI_4;
            let q = add(
                c,
                Point {
                    x: a.cos(),
                    y: a.sin(),
                },
                30.0,
            );
            !surface.wet(q) && (surface.height_at(q) - h).abs() <= 30.0 * cfg.max_lane_grade
        })
    };
    // The nearest banks that work (at most six, 300 m apart), then the one
    // with the most buildable land around its centre.
    let mut tried: Vec<Point> = vec![];
    let mut found: Vec<(usize, Point, Point)> = vec![];
    for (d, water, bank) in banks {
        if tried.len() >= 96 || found.len() >= 6 {
            break;
        }
        if tried.iter().any(|&t| dist(t, water) < 60.0)
            || found.iter().any(|f| dist(f.2, water) < 300.0)
        {
            continue;
        }
        tried.push(water);
        let toward = unit(water, site.center);
        let start = dist(water, bank).max(reach);
        let center = (0..)
            .map(|k| start + 5.0 * k as f64)
            .take_while(|&t| t < d.min(start + reach))
            .map(|t| add(water, toward, t))
            .find(|&p| !surface.wet(p) && level(p));
        // The town grows down to its harbour: land joined to the centre by
        // street-grade moves (the footprint's own growth rule) reaches the
        // bank.
        let Some(center) = center.filter(|&c| {
            let middle = super::super::point(c, bank, 0.5);
            flood(
                surface,
                c,
                middle,
                dist(c, bank) * 0.5 + 60.0,
                12.0,
                grade,
                Some(bank),
            )
            .0
        }) else {
            continue;
        };
        if approach.route(site.center, center, cfg.max_street_grade).is_none() {
            continue;
        }
        let land = flood(
            surface,
            center,
            center,
            0.8 * site.radius,
            16.0,
            grade,
            None,
        )
        .1;
        found.push((land, center, water));
    }
    let (_, center, _) = if cfg.sheltered_harbour {found.into_iter().next()}
        else {found.into_iter().max_by_key(|f| f.0)}?;
    Some(Site {
        center,
        ..site.clone()
    })
}

/// Harbour apron: the land between a town domain and its water, within
/// `reach`, joined to the domain along its shore-facing edges, so quays stand
/// at the waterline. The footprint's growth grid stops a cell or two short of
/// a shore; the apron closes that gap where a street could reach the water
/// (never down a cliff). Returns the domain unchanged when nothing is added.
pub(in super::super::super) fn apron(
    domain: &Shape,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    reach: f64,
) -> Shape {
    const STEP: f64 = 4.0;
    let mut quads: Vec<Shape> = vec![];
    for (ring, outer) in
        std::iter::once((&domain.outer, true)).chain(domain.holes.iter().map(|h| (h, false)))
    {
        if ring.len() < 3 {
            continue;
        }
        let interior_left = (g::signed(ring) > 0.0) == outer;
        // (point, outward normal, distance to open water) every 4 m.
        let mut marks: Vec<Option<(Point, Point, f64)>> = vec![];
        for k in 0..ring.len() {
            let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
            let l = dist(a, b);
            if l < 1e-9 {
                continue;
            }
            let t = unit(a, b);
            let out = if interior_left {
                Point { x: t.y, y: -t.x }
            } else {
                left(t)
            };
            let m = (l / STEP).ceil().max(1.0) as usize;
            for j in 0..m {
                let p = add(a, t, l * j as f64 / m as f64);
                let hit = (1..=(reach / 2.0) as usize)
                    .map(|i| 2.0 * i as f64)
                    .find(|&d| {
                        let q = add(p, out, d);
                        q.x >= 0.0
                            && q.y >= 0.0
                            && q.x < surface.width
                            && q.y < surface.width
                            && surface.wet(q)
                    });
                marks.push(
                    hit.filter(|&d| {
                        d > 3.0
                            && routing::segment_clear(
                                surface,
                                p,
                                add(p, out, d - 2.5),
                                cfg.max_street_grade,
                            )
                            && surface.wet(add(p, out, d + 3.5))
                    })
                    .map(|d| (p, out, d)),
                );
            }
        }
        for k in 0..marks.len() {
            if let (Some(a), Some(b)) = (marks[k], marks[(k + 1) % marks.len()]) {
                quads.push(g::normalized(Shape {
                    outer: vec![a.0, b.0, add(b.0, b.1, b.2 + 2.0), add(a.0, a.1, a.2 + 2.0)],
                    holes: vec![],
                }));
            }
        }
    }
    if quads.is_empty() {
        return domain.clone();
    }
    quads.push(domain.clone());

    let inside = g::interior_point(domain);
    // Pockets the quads close against a stair-stepped edge are land of the
    // apron, not holes; water holes come back with the dry clip.
    g::union(&quads)
        .into_iter()
        .map(|mut s| {
            s.holes.retain(|h| g::signed(h).abs() >= 2500.0);
            s
        })
        .flat_map(|s| g::dry_clip(&surface, &s))
        .filter(|s| g::contains(s, inside))
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
        // A strip of a few square metres is no apron: the domain stays as
        // grown.
        .filter(|s| g::area(s) >= g::area(domain) + 200.0)
        .unwrap_or_else(|| domain.clone())
}

/// Flood of `step` moves at most `grade` (8-neighbour) from `from`, within
/// `half` of `middle`: whether it comes within 15 m of `to`, and how many
/// cells it covers.
fn flood(
    surface: Surface<'_>,
    from: Point,
    middle: Point,
    half: f64,
    step: f64,
    grade: f64,
    to: Option<Point>,
) -> (bool, usize) {
    let side = ((2.0 * half / step).ceil() as usize).max(2);
    let origin = Point {
        x: middle.x - half,
        y: middle.y - half,
    };
    let at = |i: usize| Point {
        x: origin.x + (i % side) as f64 * step,
        y: origin.y + (i / side) as f64 * step,
    };
    let (x, y) = (
        ((from.x - origin.x) / step).round(),
        ((from.y - origin.y) / step).round(),
    );
    if x < 0.0 || y < 0.0 || x as usize >= side || y as usize >= side {
        return (false, 0);
    }
    let start = y as usize * side + x as usize;
    let mut seen = vec![false; side * side];
    let mut queue = std::collections::VecDeque::from([start]);
    seen[start] = true;
    let mut count = 0;
    while let Some(i) = queue.pop_front() {
        // The first move starts from the point itself.
        let p = if i == start { from } else { at(i) };
        count += 1;
        if let Some(t) = to
            && (dist(p, t) <= 15.0
                || dist(p, t) <= step * 1.5 && routing::segment_clear(surface, p, t, grade))
        {
            return (true, count);
        }
        let (x, y) = ((i % side) as i64, (i / side) as i64);
        for (dx, dy) in [
            (1, 0),
            (-1, 0),
            (0, 1),
            (0, -1),
            (1, 1),
            (1, -1),
            (-1, 1),
            (-1, -1),
        ] {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= side as i64 || ny >= side as i64 {
                continue;
            }
            let j = ny as usize * side + nx as usize;
            if !seen[j]
                && dist(at(j), middle) <= half
                && routing::segment_clear(surface, p, at(j), grade)
            {
                seen[j] = true;
                queue.push_back(j);
            }
        }
    }
    (false, count)
}
