//! Homestead and activity plots for isolated settlements.

use super::*;

/// City Bench `activity` intent: one `activities.json` site as the whole place. Its
/// buildings (laid again by `building_sites` from the centre and axis kept in the
/// structure) stand in one plot hugging the yard, its installations around it as
/// ground blocks, a track to the nearest road. A water-working template stands on a bank.
fn activity_plot(site: &Site, cfg: &LayoutConfig, near: &Option<Near>, obstacles: &[Shape], surface: Surface<'_>) -> Option<Plan> {
    // The site itself first, then rings of other centres round it: a road junction or a slope may refuse it.
    let ring = (0..=32).map(|k| if k == 0 { (0.0, 0.0) } else { let (r, i) = ([70.0, 120.0, 180.0, 260.0][(k - 1) / 8], ((k - 1) % 8) as f64); (r, i * std::f64::consts::FRAC_PI_4) });
    for (r, angle) in ring {
        let origin = Point { x: site.center.x + r * angle.cos(), y: site.center.y + r * angle.sin() };
        if let Some(plan) = activity_try(site, cfg, near, obstacles, surface, origin) {
            return Some(plan);
        }
    }
    eprintln!("activity_plot {}: no centre found round ({:.0},{:.0})", cfg.programme.template, site.center.x, site.center.y);
    None
}

#[allow(clippy::too_many_arguments)]
fn activity_try(site: &Site, cfg: &LayoutConfig, near: &Option<Near>, obstacles: &[Shape], surface: Surface<'_>, origin: Point) -> Option<Plan> {
    use super::super::activities as act;
    let template = cfg.programme.template.as_str();
    let culture = culture(site, cfg);
    let bank = act::site_wants_water(template).then(|| bank(&surface, origin, MILL_REACH)).flatten();
    let mut c = bank.map_or(origin, |(q, inland)| at(q, inland, 36.0));
    // Clear of the road (a site on the road itself steps aside, across it).
    if bank.is_none()
        && let Some(n) = near
        && dist(c, n.point) < 55.0
    {
        let away = if dist(c, n.point) > 0.5 { unit(n.point, c) } else { perp(n.tangent) };
        c = at(c, away, 55.0 - dist(c, n.point));
    }
    let toward = bank.map_or_else(|| near.as_ref().map_or(Point { x: 0.0, y: 1.0 }, |n| unit(c, n.point)), |(_, inland)| inland);
    let u = perp(toward);
    let v = perp(u);
    let yard = act::site_yard(template, culture, &site.key, c, u.y.atan2(u.x), &surface);
    if yard.is_empty() {
        return None;
    }
    // Oriented rectangle over the yard, a margin round it.
    let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in yard.iter().flat_map(|b| &b.ring) {
        let (s, t) = ((p.x - c.x) * u.x + (p.y - c.y) * u.y, (p.x - c.x) * v.x + (p.y - c.y) * v.y);
        (s0, s1, t0, t1) = (s0.min(s), s1.max(s), t0.min(t), t1.max(t));
    }
    // The plot holds at least the envelope the programme admits for an isolated lot of
    // this culture (frontage along u, depth along v): a small yard (a shrine, a yard
    // that lost a body on the shore) otherwise leaves no admissible block to reserve.
    if let Some(m) = super::super::culture::isolated_mapping(culture, &cfg.programme.period, &cfg.programme.intent) {
        let grow = |lo: &mut f64, hi: &mut f64, need: f64| {
            let extra = (need - (*hi - *lo + 10.0)).max(0.0) * 0.5;
            *lo -= extra;
            *hi += extra;
        };
        grow(&mut s0, &mut s1, m.admissibility.min_frontage + 2.0 * m.admissibility.min_access_width + 1.0);
        grow(&mut t0, &mut t1, m.admissibility.min_depth + 1.0);
    }
    let corner = |s: f64, t: f64| Point { x: c.x + u.x * s + v.x * t, y: c.y + u.y * s + v.y * t };
    let plot = Shape { outer: vec![corner(s0 - 5.0, t0 - 5.0), corner(s1 + 5.0, t0 - 5.0), corner(s1 + 5.0, t1 + 5.0), corner(s0 - 5.0, t1 + 5.0)], holes: vec![] };
    // The front edge faces the road (or inland): a track runs along it, joined to the road, so
    // the plot has the street frontage the programme asks of an isolated lot.
    let want = near.as_ref().filter(|n| dist(c, n.point) > 1.0).map_or(toward, |n| unit(c, n.point));
    let mid = plot.outer.iter().fold(Point { x: 0.0, y: 0.0 }, |m, p| Point { x: m.x + p.x * 0.25, y: m.y + p.y * 0.25 });
    let (a, b, out) = (0..4)
        .map(|i| {
            let (a, b) = (plot.outer[i], plot.outer[(i + 1) % 4]);
            let n = unit(mid, Point { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
            (a, b, n)
        })
        .max_by(|p, q| (p.2.x * want.x + p.2.y * want.y).total_cmp(&(q.2.x * want.x + q.2.y * want.y)))?;
    let (a, b) = (at(a, out, 1.55), at(b, out, 1.55));
    let mut blocked = obstacles.to_vec();
    let mut path = match near {
        Some(n) if dist(c, n.point) > 20.0 => {
            let (start, end) = if dist(n.point, a) < dist(n.point, b) { (a, b) } else { (b, a) };
            let mut p = track(surface, n.point, start, cfg.max_lane_grade);
            p.push(end);
            p
        }
        _ => vec![a, b],
    };
    path.dedup_by(|p, q| dist(*p, *q) < 1e-6);
    if path.len() > 2 {
        blocked.extend(g::ribbon(&path[..path.len() - 1], &[3.0]));
    }
    let streets = vec![street(path, 3.0, 3, "track")];
    let Some(plot) = settle(&plot, &blocked, &surface, 0.5) else {
        return None;
    };
    // Every body of the yard stands on its plot: a road or a bank cutting the plot through
    // a building refuses this centre (the next one round the site is tried).
    if !yard.iter().all(|b| b.ring.iter().all(|&p| g::contains(&plot, p))) {
        return None;
    }
    let mut blocks = vec![(plot.clone(), "block")];
    blocked.push(plot.clone());
    let outside = |p: Point| g::contains(&plot, p);
    for inst in act::site_installations(template, culture, &site.key, c, &yard, &surface, &outside) {
        let kind = match inst.kind.as_str() {
            "enclosure" | "water_structure" => "common",
            "terrace" => "garden",
            _ => "place",
        };
        let shapes = if inst.closed {
            vec![g::normalized(Shape { outer: inst.points.clone(), holes: vec![] })]
        } else {
            g::ribbon(&inst.points, &vec![2.5; inst.points.len()])
        };
        for shape in shapes {
            // The dry pieces of the installation clear of the plot and the roads (a weir or a
            // pier crossing water keeps its shore ends).
            let mut pieces = g::dry_clip(&surface, &shape);
            for o in &blocked {
                pieces = pieces.iter().flat_map(|s| g::difference(s, o)).collect();
            }
            blocks.extend(pieces.into_iter().filter(|s| g::area(s) > 6.0).map(|s| (s, kind)));
        }
    }
    Some(Plan { center: c, blocks, streets, axis: u })
}

/// One plot: on the road when the site is beside it, otherwise at the site
/// with a track along its front to the road.
#[allow(clippy::too_many_arguments)]
pub(super) fn homestead(
    site: &Site,
    cfg: &LayoutConfig,
    kind: Kind,
    near: &Option<Near>,
    obstacles: &[Shape],
    road_half: &dyn Fn(&Near) -> f64,
    roads: &[Street],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<Plan> {
    if cfg.programme.intent == "activity" {
        return activity_plot(site, cfg, near, obstacles, surface);
    }
    let intent = cfg.programme.intent.as_str();
    let culture = culture(site, cfg);
    let (mut w, mut d) = plot_size(kind, intent, culture, &site.key, rng);
    // Never under the envelope the programme admits for a lone lot of this culture
    // (a farm of a place too small for a hamlet is admitted as an isolated farm).
    let admitted = if roles::is_isolated(intent) { intent } else { "isolated-farm" };
    if (matches!(kind, Kind::Farmstead | Kind::Ruin) || roles::is_isolated(intent))
        && let Some(m) = super::super::culture::isolated_mapping(culture, &cfg.programme.period, admitted)
    {
        w = w.max(m.admissibility.min_frontage + 2.0 * m.admissibility.min_access_width + 2.0);
        d = d.max(m.admissibility.min_depth + 2.0);
    }
    // A mill stands on its race: on the nearest bank within reach, its plot
    // backing onto the water (dry-clipped to the bank by `settle`).
    let bank = (cfg.programme.intent == "isolated-mill")
        .then(|| bank(&surface, site.center, MILL_REACH))
        .flatten();
    let c = bank.map_or(site.center, |(q, inland)| at(q, inland, d * 0.5 - 3.0));
    if bank.is_none()
        && let Some(n) = near
    {
        let half = road_half(n);
        if n.distance <= d * 0.5 + half + 40.0 {
            let toward = (c.x - n.point.x) * -n.tangent.y + (c.y - n.point.y) * n.tangent.x > 0.0;
            let plan = |plot: Shape| Plan {
                center: g::interior_point(&plot),
                blocks: vec![(plot, "block")],
                streets: vec![],
                axis: n.tangent,
            };
            // The whole planned plot first (« un bâtiment isolé a son
            // terrain »): stations stepped along the road away from the
            // junction that would cut it, then the best partial plot.
            let mut partial = None;
            for k in [0.0, 1.0, -1.0, 2.0, -2.0] {
                let station = n.station + k * w;
                let path = slice(&roads[n.road].path, station - w * 0.5, station + w * 0.5);
                for left in [toward, !toward] {
                    let Some(plot) = side(&path, half, d, left)
                        .and_then(|p| settle(&p, obstacles, &surface, 0.6))
                    else {
                        continue;
                    };
                    if g::area(&plot) >= WHOLE_PLOT * w * d {
                        return Some(plan(plot));
                    }
                    if k == 0.0 && partial.is_none() {
                        partial = Some(plot);
                    }
                }
            }
            if let Some(plot) = partial {
                return Some(plan(plot));
            }
        }
    }
    // The front faces the road (a mill's faces inland, its back on the
    // water); a farm track runs along it.
    let toward = bank.map_or_else(
        || {
            near.as_ref()
                // A road ending at the place's centre (an isolated farm is a road
                // endpoint) gives no direction to it: the plot then fronts the road's side.
                .map_or(Point { x: 0.0, y: 1.0 }, |n| if dist(c, n.point) > 1.0 { unit(c, n.point) } else { perp(n.tangent) })
        },
        |(_, inland)| inland,
    );
    let along = perp(toward);
    let half = 1.5;
    let front = at(c, toward, d * 0.5 + half);
    let a = at(front, along, -(w * 0.5 + 4.0));
    let b = at(front, along, w * 0.5 + 4.0);
    let lane = [a, b];
    let plot = side(&lane, half, d, true)
        .filter(|p| g::contains(p, c) || dist(g::interior_point(p), c) < d)
        .or_else(|| side(&lane, half, d, false))
        .filter(|p| dist(g::interior_point(p), c) < d)
        // Never a farm without its lot: the plain rectangle behind the lane.
        .unwrap_or_else(|| g::normalized(Shape { outer: [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
            .iter().map(|&(s, t)| at(at(c, along, s * w), toward, t * d)).collect(), holes: vec![] }));
    let mut path = match near {
        Some(n) => {
            let start = if dist(n.point, a) < dist(n.point, b) {
                a
            } else {
                b
            };
            let mut p = track(surface, n.point, start, cfg.max_lane_grade);
            p.push(if start == a { b } else { a });
            p
        }
        None => lane.to_vec(),
    };
    path.dedup_by(|p, q| dist(*p, *q) < 1e-6);
    let mut blocked = obstacles.to_vec();
    if path.len() > 2 {
        blocked.extend(g::ribbon(&path[..path.len() - 1], &[half * 2.0]));
    }
    // A track wandering through the plot (hill routes) or an obstacle cutting it must
    // not leave the farm without its farmhouse: a smaller remaining piece first, then
    // the plot clear of the obstacles only (the track then ends at its edge).
    let plot = settle(&plot, &blocked, &surface, 0.6)
        .or_else(|| settle(&plot, &blocked, &surface, 0.3))
        .or_else(|| settle(&plot, obstacles, &surface, 0.3))?;
    Some(Plan {
        center: g::interior_point(&plot),
        blocks: vec![(plot, "block")],
        streets: vec![street(path, half * 2.0, 3, "track")],
        axis: along,
    })
}
