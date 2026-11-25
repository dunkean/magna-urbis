//! Ring camps and their grown layouts.

use super::*;

/// Tents or huts on both sides of a ring way around an open centre, cut into
/// sectors; a track joins the ring to the road.
pub(super) fn camp(
    site: &Site,
    cfg: &LayoutConfig,
    near: &Option<Near>,
    obstacles: &[Shape],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<Plan> {
    if cfg.camp_growth != "ring" {
        return grown_camp(site, cfg, near, obstacles, surface, rng);
    }
    // One tent per household, and a tenth more for the camp's own uses (as
    // `grown_camp`): the ring is sized for the programme it must lodge.
    let tents = (super::super::footprint::capacity::households(culture(site, cfg), site.population) * 1.1).ceil().max(2.0);
    let depth = 14.0;
    let half = 1.5;
    // Ring length ≈ tents along both sides at ~7 m each.
    let radius = (tents * 7.0 / 2.0 / std::f64::consts::TAU).clamp(14.0, 220.0);
    let c = site.center;
    // `ringWobble` (culture data, 0 = perfect circle): the contour swells and
    // narrows by up to that share of the radius, smoothly, so it stays a camp circle.
    let wobble = cfg.camp_ring_wobble.unwrap_or_else(|| super::super::catalogue()["cultures"][culture(site, cfg)]["camp"]["ringWobble"].as_f64().unwrap_or(0.0)).clamp(0.0, 0.4);
    let phases = if wobble > 0.0 { let mut w = rng.fork("ring-wobble"); [w.range(0.0, std::f64::consts::TAU), w.range(0.0, std::f64::consts::TAU), w.range(0.0, std::f64::consts::TAU)] } else { [0.0; 3] };
    let reach_at = |a: f64| radius * (1.0 + wobble * (0.5 * (2.0 * a + phases[0]).sin() + 0.3 * (3.0 * a + phases[1]).sin() + 0.2 * (5.0 * a + phases[2]).sin()));
    let n = if wobble > 0.0 { 48 } else { 24 };
    let mut ring: Vec<Point> = (0..=n)
        .map(|i| {
            let a = i as f64 * std::f64::consts::TAU / n as f64;
            at(c, Point { x: a.cos(), y: a.sin() }, reach_at(a))
        })
        .collect();
    ring[n] = ring[0];
    let sectors = ((tents / 4.0).ceil() as usize).clamp(4, 16);
    let mut bearings = vec![];
    let gaps: Vec<Shape> = (0..sectors)
        .flat_map(|k| {
            let a = (k as f64 + rng.range(-0.1, 0.1)) * std::f64::consts::TAU / sectors as f64;
            bearings.push(a);
            let d = Point {
                x: a.cos(),
                y: a.sin(),
            };
            g::ribbon(
                &[
                    at(c, d, reach_at(a) - depth - 6.0),
                    at(c, d, reach_at(a) + depth + 6.0),
                ],
                &[2.5],
            )
        })
        .collect();
    let inner = g::ribbon(&ring, &[half * 2.0]);
    let band = g::ribbon(&ring, &[(half + depth) * 2.0]);
    let mut pieces: Vec<Shape> = band
        .iter()
        .flat_map(|o| {
            inner.iter().fold(vec![o.clone()], |acc, i| {
                acc.iter().flat_map(|s| g::difference(s, i)).collect()
            })
        })
        .collect();
    for gap in &gaps {
        pieces = pieces.iter().flat_map(|p| g::difference(p, gap)).collect();
    }
    // Invariant: one piece per tent. Each sector is cut along the track into
    // pitches of about 7 m (the ring's sizing), so a large camp never folds
    // several households into one sector lot that houses one of them.
    let pitch_cuts: Vec<Shape> = (0..sectors)
        .flat_map(|k| {
            let (a0, a1) = (bearings[k], if k + 1 < sectors { bearings[k + 1] } else { bearings[0] + std::f64::consts::TAU });
            let mid = reach_at(0.5 * (a0 + a1));
            let n = ((a1 - a0) * mid / 7.0).round().max(1.0) as usize;
            (1..n).map(move |j| a0 + (a1 - a0) * j as f64 / n as f64).collect::<Vec<_>>()
        })
        .flat_map(|a| {
            let d = Point { x: a.cos(), y: a.sin() };
            g::ribbon(&[at(c, d, reach_at(a) - depth - 6.0), at(c, d, reach_at(a) + depth + 6.0)], &[1.0])
        })
        .collect();
    for cut in &pitch_cuts {
        let (x0, y0, x1, y1) = g::bbox(cut);
        pieces = pieces.iter().flat_map(|p| {
            let (a0, b0, a1, b1) = g::bbox(p);
            if a0 > x1 || a1 < x0 || b0 > y1 || b1 < y0 { vec![p.clone()] } else { g::difference(p, cut) }
        }).collect();
    }
    let mut blocks: Vec<(Shape, &'static str)> = pieces
        .iter()
        .filter_map(|p| settle(p, obstacles, &surface, 0.5))
        .filter(|p| g::area(p) > 40.0)
        .map(|p| (p, "block"))
        .collect();
    // The open centre: a common for herds, fires and gatherings.
    let centre_radius = radius * (1.0 - wobble) - half - depth - 2.0;
    if centre_radius > 6.0 {
        let disc = Shape {
            outer: (0..n)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / n as f64;
                    at(c, Point { x: a.cos(), y: a.sin() }, (reach_at(a) - half - depth - 2.0).max(6.0))
                })
                .collect(),
            holes: vec![],
        };
        if let Some(d) = settle(&g::normalized(disc), obstacles, &surface, 0.5) {
            blocks.push((d, "place"));
        }
    }
    let mut streets = vec![street(ring.clone(), half * 2.0, 3, "track")];
    if let Some(n) = near.as_ref().filter(|n| n.distance > radius * (1.0 + wobble)) {
        let entry = at(c, unit(c, n.point), reach_at((n.point.y - c.y).atan2(n.point.x - c.x)));
        // No track when the road cannot be reached over land (`track`).
        let way = track(surface, n.point, entry, cfg.max_lane_grade);
        if way.len() >= 2 {
            streets.push(street(way, half * 2.0, 3, "track"));
        }
    }
    Some(Plan {
        blocks,
        streets,
        center: c,
        axis: Point { x: 1.0, y: 0.0 },
    })
}

fn grown_camp(
    site: &Site,
    cfg: &LayoutConfig,
    near: &Option<Near>,
    obstacles: &[Shape],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<Plan> {
    use std::f64::consts::{PI, TAU};
    // One piece per household, and a tenth more for the camp's own uses.
    let tents = (super::super::footprint::capacity::households(culture(site, cfg), site.population) * 1.1).ceil().max(2.0) as usize;
    let (pitch, depth, half, strip) = (8.0, 12.0, 1.5, 4.0);
    let step = 2.0 * (half + depth) + strip;
    let first = depth + half + 8.0;
    let c = site.center;
    let entry_dir = near.as_ref().map_or(0.0, |n| (n.point.y - c.y).atan2(n.point.x - c.x));
    let dirv = |a: f64| Point { x: a.cos(), y: a.sin() };
    let sectors = |r: f64| ((TAU * r / pitch).floor() as usize).max(3);
    // Units: (centre, ring radii, tents).
    let mut units: Vec<(Point, Vec<f64>, usize)> = vec![];
    if cfg.camp_growth == "clusters" {
        let data = &super::super::catalogue()["cultures"][culture(site, cfg)]["camp"];
        let spread = data["groupVariation"].as_f64().unwrap_or(0.0).clamp(0.0, 0.75);
        let mut rng = rng.fork("camp-groups");
        let per = (40.0 * rng.range(1.0 - 0.3 * spread, 1.0 + 0.3 * spread)).round() as usize;
        let disc = |o: Point, r: f64| Shape {
            outer: (0..32).map(|i| at(o, dirv(i as f64 * TAU / 32.0), r)).collect(),
            holes: vec![],
        };
        for count in (1..=tents.div_ceil(per).max(1)).rev() {
            let sizes = if spread > 0.0 { camp_variation::groups(tents, count, spread, &mut rng.fork(&count.to_string())) }
                else { (0..count).map(|u|tents/count + usize::from(u<tents%count)).collect() };
            let k = sizes.iter().copied().max().unwrap_or(tents);
            let slack = if spread > 0.0 { 0.25 } else { 0.0 };
            let r = ((k.div_ceil(2) as f64 + slack) * pitch / TAU).max(first);
            let reach = r + half + depth;
            let mut centres = vec![c];
            'unit: for _ in 1..count {
                for ring in 0..30 {
                    let d = 2.0 * reach + 12.0 + ring as f64 * 0.25 * reach;
                    for t in 0..24 {
                        let side = if t % 2 == 0 { 1.0 } else { -1.0 };
                        let a = entry_dir + PI + side * ((t + 1) / 2) as f64 * TAU / 24.0;
                        let o = at(c, dirv(a), d);
                        if centres.iter().any(|&q| dist(q, o) < 2.0 * reach + 12.0) {
                            continue;
                        }
                        if settle(&g::normalized(disc(o, reach)), obstacles, &surface, 0.95).is_some() {
                            centres.push(o);
                            continue 'unit;
                        }
                    }
                }
                break;
            }
            if centres.len() == count || count == 1 {
                units = centres.iter().zip(sizes).map(|(&o, k)| (o, vec![if spread > 0.0 { ((k.div_ceil(2) as f64 + slack) * pitch / TAU).max(first) } else { r }], k)).collect();
                break;
            }
        }
    } else {
        let r0 = (60.0 * pitch / (2.0 * TAU)).max(first);
        let (mut radii, mut held) = (vec![], 0);
        while held < tents && radii.len() < 12 {
            let r = r0 + radii.len() as f64 * step;
            held += sectors(r) * 2;
            radii.push(r);
        }
        units.push((c, radii, tents));
    }
    let outer = units[0].1.last().copied().unwrap_or(first);
    let mut streets = vec![];
    // Tracks crossing the tent rows: radial spokes, the links between camps.
    let mut cuts: Vec<Vec<Point>> = vec![];
    if units.len() == 1 && units[0].1.len() > 1 {
        let r0 = units[0].1[0];
        for j in 0..4 {
            let d = dirv(entry_dir + j as f64 * 0.5 * PI);
            cuts.push(vec![at(c, d, r0), at(c, d, outer)]);
        }
    }
    for (o, radii, _) in units.iter().skip(1) {
        cuts.push(vec![at(*o, unit(*o, c), radii[0]), at(c, unit(c, *o), outer)]);
    }
    let all: Vec<Shape> = obstacles.iter().cloned().chain(cuts.iter().flat_map(|p| g::ribbon(p, &[2.0 * half + 1.0]))).collect();
    let mut blocks: Vec<(Shape, &'static str)> = vec![];
    for (o, radii, k) in &units {
        let o = *o;
        let back = if dist(o, c) > 1.0 { (o.y - c.y).atan2(o.x - c.x) } else { entry_dir + PI };
        let mut left = *k;
        for &r in radii {
            let n = sectors(r);
            let m = ((TAU * r / 4.0).ceil() as usize).max(24);
            let mut ring: Vec<Point> = (0..=m).map(|i| at(o, dirv(i as f64 * TAU / m as f64), r)).collect();
            ring[m] = ring[0];
            streets.push(street(ring, half * 2.0, 3, "track"));
            // Sectors from the back (away from the entry) toward the front,
            // both sides of the track: a partial ring stays behind.
            let mid = |i: usize| (i as f64 + 0.5) * TAU / n as f64;
            let off = |a: f64| (a - back).rem_euclid(TAU).min(TAU - (a - back).rem_euclid(TAU));
            let mut order: Vec<usize> = (0..n).collect();
            order.sort_by(|&a, &b| off(mid(a)).total_cmp(&off(mid(b))).then(a.cmp(&b)));
            for i in order {
                let gap = 0.5 / r;
                let (a0, a1) = (i as f64 * TAU / n as f64 + gap, (i + 1) as f64 * TAU / n as f64 - gap);
                for (r_in, r_out) in [(r + half, r + half + depth), (r - half - depth, r - half)] {
                    if left == 0 || r_in <= 1.0 {
                        continue;
                    }
                    let arc = |rr: f64| (0..=4).map(move |s| (s, rr));
                    let mut outline: Vec<Point> = arc(r_out).map(|(s, rr)| at(o, dirv(a0 + (a1 - a0) * s as f64 / 4.0), rr)).collect();
                    outline.extend(arc(r_in).collect::<Vec<_>>().into_iter().rev().map(|(s, rr)| at(o, dirv(a0 + (a1 - a0) * s as f64 / 4.0), rr)));
                    let piece = g::normalized(Shape { outer: outline, holes: vec![] });
                    if let Some(p) = settle(&piece, &all, &surface, 0.5) {
                        blocks.push((p, "block"));
                        left -= 1;
                    }
                }
            }
        }
        // The open centre: a common for herds, fires and gatherings.
        let cr = radii[0] - half - depth - 2.0;
        if cr > 6.0 {
            let disc = Shape { outer: (0..24).map(|i| at(o, dirv(i as f64 * TAU / 24.0), cr)).collect(), holes: vec![] };
            if let Some(d) = settle(&g::normalized(disc), obstacles, &surface, 0.5) {
                blocks.push((d, "place"));
            }
        }
    }
    for p in cuts {
        streets.push(street(p, half * 2.0, 3, "track"));
    }
    if let Some(n) = near.as_ref().filter(|n| n.distance > outer) {
        let entry = at(c, unit(c, n.point), outer);
        let way = track(surface, n.point, entry, cfg.max_lane_grade);
        if way.len() >= 2 {
            streets.push(street(way, half * 2.0, 3, "track"));
        }
    }
    Some(Plan { blocks, streets, center: c, axis: Point { x: 1.0, y: 0.0 } })
}
