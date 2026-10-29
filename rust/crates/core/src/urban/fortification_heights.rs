//! Castle on the heights. A town crowned by a knoll puts its castle there, in
//! its own circuit following the hill's contour: inside the town wall when
//! the knoll stands within it, astride the wall when it stands at the rim
//! (the town wall then runs round the castle and meets its curtain). The
//! programme's castle or keep (`site: summit`) lands in it by the same height.
use super::*;
use super::super::LayoutConfig;

/// Share of towns that crown their knoll (fortifications.json `heightsCastle`,
/// culture then group); planned and Chinese cities keep their palace precinct.
fn culture_share(culture: &str) -> f64 {
    culture_override(culture).iter().rev().find_map(|v| v["heightsCastle"].as_f64())
        .unwrap_or_else(|| num(group(culture), "heightsCastle", 0.0))
}

/// The castle circuit, or `None`: `heightsCastle` "none", a flat site, a
/// culture without castles, or a knoll that cannot hold a dry circuit.
/// `force` takes the highest knoll even where it barely rises.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn heights_castle(walls: &[Shape], occupied: &[Shape], streets: &[Street], surface: Surface<'_>, cfg: &LayoutConfig,
    culture: &str, pop: u32, base: &Rng) -> Option<Shape> {
    let force = cfg.heights_castle == "force";
    if cfg.heights_castle == "none" || !force && (pop < 600 || !base.fork("heights-castle").chance(culture_share(culture))) {
        return None;
    }
    let town = walls.iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
    // Castle bailey: 0.35 ha for a small town up to 2.2 ha for a capital.
    let want = (3500.0 + 0.3 * pop as f64).clamp(3500.0, 22_000.0);
    let r = (want / std::f64::consts::PI).sqrt();
    let reach = buffer(town, 0.6 * r).into_iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
    let cell = (surface.width / surface.n as f64).max(8.0);
    let (lo, hi) = reach.outer.iter().fold((pt(f64::MAX, f64::MAX), pt(f64::MIN, f64::MIN)),
        |(l, h), p| (pt(l.x.min(p.x), l.y.min(p.y)), pt(h.x.max(p.x), h.y.max(p.y))));
    let mut inside = vec![];
    let mut spots = vec![];
    let mut y = lo.y + 0.5 * cell;
    while y < hi.y {
        let mut x = lo.x + 0.5 * cell;
        while x < hi.x {
            let p = pt(x, y);
            if !surface.wet(p) && g::contains(&reach, p) {
                let h = surface.height_at(p);
                if g::contains(town, p) { inside.push(h); }
                spots.push((p, h));
            }
            x += cell;
        }
        y += cell;
    }
    if inside.len() < 8 { return None; }
    inside.sort_by(f64::total_cmp);
    let median = inside[inside.len() / 2];
    // Prominence over a ring 1.5 castle radii out: a knoll, not a slope.
    let ring = |p: Point| (0..12).map(|k| {
        let a = k as f64 * std::f64::consts::TAU / 12.0;
        surface.height_at(pt(p.x + 1.5 * r * a.cos(), p.y + 1.5 * r * a.sin()))
    }).sum::<f64>() / 12.0;
    let mut knolls: Vec<(Point, f64, f64, f64)> = spots.iter()
        .map(|&(p, h)| (p, h, h - median, h - ring(p))).collect();
    knolls.sort_by(|a, b| (b.2 + 1.5 * b.3).total_cmp(&(a.2 + 1.5 * a.3)));
    // The best knolls in turn (a radius apart): the first whose bailey holds
    // a dry circuit standing in or astride the town.
    // A street of the plan climbs into the bailey (its gate, the lots of its
    // court): a knoll no street reaches would stay an empty walled wood.
    let entered = |c: &Shape| streets.iter()
        .filter(|st| !matches!(st.role.as_str(), "boundary" | "bridge" | "wall-lane"))
        .any(|st| st.path.windows(2).any(|w| {
            let m = pt((w[0].x + w[1].x) * 0.5, (w[0].y + w[1].y) * 0.5);
            [w[0], m, w[1]].iter().any(|&p| g::contains(c, p) && (0..c.outer.len())
                .map(|k| g::distance(p, c.outer[k], c.outer[(k + 1) % c.outer.len()]).0).fold(f64::INFINITY, f64::min) > 6.0)
        }));
    let mut tried: Vec<Point> = vec![];
    for &(top, h_top, rise, prominence) in &knolls {
        if tried.len() >= 8 { break; }
        if tried.iter().any(|q| (q.x - top.x).hypot(q.y - top.y) < r) { continue; }
        tried.push(top);
        if !force && (rise < 5.0 || prominence < 3.0) { break; }
        // The bailey follows the hill: each ray stops where the ground falls
        // below the summit by a share of the knoll's height, within 0.6–1.5 r.
        let drop = (0.45 * rise).clamp(3.0, 14.0);
        let mut radii: Vec<f64> = (0..32).map(|k| {
            let a = k as f64 * std::f64::consts::TAU / 32.0;
            let u = (a.cos(), a.sin());
            let mut d = 0.0;
            while d < 1.5 * r {
                let q = add(top, u, d + 3.0);
                if surface.wet(q) || surface.height_at(q) < h_top - drop { break; }
                d += 3.0;
            }
            d.clamp(0.6 * r, 1.5 * r)
        }).collect();
        for _ in 0..2 {
            let n = radii.len();
            radii = (0..n).map(|k| 0.25 * radii[(k + n - 1) % n] + 0.5 * radii[k] + 0.25 * radii[(k + 1) % n]).collect();
        }
        let outer: Vec<Point> = radii.iter().enumerate().map(|(k, &d)| {
            let a = k as f64 * std::f64::consts::TAU / 32.0;
            add(top, (a.cos(), a.sin()), d)
        }).collect();
        let castle = village_trace(&g::normalized(Shape { outer, holes: vec![] }), cell, true);
        let area = g::area(&castle);
        let dry: f64 = g::dry_clip(&surface, &castle).iter().map(g::area).sum();
        // Held by the town's own quarters, not merely by its wall: a wooded
        // ridge the wall takes in but the town leaves empty carries no castle.
        let held: f64 = occupied.iter().flat_map(|q| g::intersection(&castle, q)).map(|p| g::area(&p)).sum();
        // The bailey is a levelled top the town can build on, not a wooded
        // slope: most of it within a street-like grade.
        let level = {
            let (mut n, mut ok) = (0, 0);
            let c = g::centroid(&castle);
            for i in -6..=6 {
                for j in -6..=6 {
                    let p = pt(c.x + i as f64 * 0.25 * r, c.y + j as f64 * 0.25 * r);
                    if !g::contains(&castle, p) { continue; }
                    let d = 4.0;
                    let gx = (surface.height_at(pt(p.x + d, p.y)) - surface.height_at(pt(p.x - d, p.y))) / (2.0 * d);
                    let gy = (surface.height_at(pt(p.x, p.y + d)) - surface.height_at(pt(p.x, p.y - d))) / (2.0 * d);
                    n += 1;
                    ok += usize::from(gx.hypot(gy) <= cfg.max_street_grade.max(0.12) * 1.5);
                }
            }
            n > 0 && ok * 5 >= n * 3
        };
        // A castle stands in or astride its town, never cut off from it.
        if castle.outer.len() >= 3 && g::simple(&castle) && (0.35 * want..=2.6 * want).contains(&area)
            && dry >= 0.97 * area && held >= 0.6 * area && level && entered(&castle) {
            return Some(castle);
        }
    }
    None
}

/// The town wall runs round a castle standing at its rim; a castle within
/// the town leaves it unchanged.
pub(in super::super) fn wrap_castle(walls: Vec<Shape>, castle: &Shape) -> Vec<Shape> {
    walls.into_iter().map(|w| {
        if g::intersection(&w, castle).iter().map(g::area).sum::<f64>() < 1.0 { return w; }
        match g::union(&[w.clone(), castle.clone()]).as_slice() {
            [one] if one.holes.is_empty() && g::simple(one) => one.clone(),
            _ => w,
        }
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_knoll_at_the_rim_carries_a_castle_the_town_wall_runs_round() {
        let n = 128;
        let width = 1280.0;
        let knoll = pt(850.0, 640.0);
        let height: Vec<f32> = (0..n * n).map(|i| {
            let p = pt((i % n) as f64 * 10.0 + 5.0, (i / n) as f64 * 10.0 + 5.0);
            let d = (p.x - knoll.x).hypot(p.y - knoll.y);
            (30.0 * (-(d * d) / (2.0 * 110.0 * 110.0)).exp()) as f32
        }).collect();
        let flat = vec![0.0_f32; n * n];
        let water = vec![0_u8; n * n];
        let town = Shape { outer: vec![pt(400.0, 400.0), pt(880.0, 400.0), pt(880.0, 880.0), pt(400.0, 880.0)], holes: vec![] };
        let cfg = LayoutConfig { heights_castle: "force".into(), ..Default::default() };
        let street = [Street { path: vec![pt(500.0, 640.0), knoll], widths: vec![6.0; 2], rank: 1, role: "street".into() }];
        let surface = Surface { geometry: None, width, n, height: &height, water: &water };
        let castle = heights_castle(std::slice::from_ref(&town), std::slice::from_ref(&town), &street, surface, &cfg, "european-organic", 5000, &Rng::new("castle"))
            .expect("a castle on the knoll");
        assert!(g::contains(&castle, knoll), "the castle crowns the knoll");
        let wrapped = wrap_castle(vec![town.clone()], &castle);
        assert!(g::area(&wrapped[0]) > g::area(&town) + 500.0, "the town wall runs round the castle astride it");
        let auto = LayoutConfig::default();
        let level = Surface { geometry: None, width, n, height: &flat, water: &water };
        assert!(heights_castle(std::slice::from_ref(&town), std::slice::from_ref(&town), &street, level, &auto, "european-organic", 5000, &Rng::new("castle")).is_none(),
            "no knoll, no castle");
    }
}
