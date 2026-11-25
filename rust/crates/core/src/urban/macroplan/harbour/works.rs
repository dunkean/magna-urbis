//! Budgeting and laying out harbour streets and works.

use super::*;

// A small landing grows linearly with demand; major ports retain longer fronts.
// Lagoon towns (fondamenta) line every canal: their quays are the street.
pub(super) fn quay_budget(site: &Site, cfg: &LayoutConfig, h: Harbour) -> f64 {
    if h.fondamenta { return f64::INFINITY; }
    let population = f64::from(site.population.max(1));
    let port = cfg.programme.functions.map_or(0.0, |f| f.port).clamp(0.0, 1.0);
    let factor = 1.0 + port.max(if cfg.site_archetype == "harbor" { 0.5 } else { 0.0 });
    (population * 0.035 * factor).clamp(20.0, (h.quay_per_sqrt_pop * population.sqrt()).max(20.0))
}

/// The `budget` metres of `path` centred on its point nearest `c`.
pub(super) fn centred(path: &[Point], c: Point, budget: f64) -> Vec<Point> {
    let total = length(path);
    let mut s = 0.0;
    let (mut at, mut best) = (0.0, f64::INFINITY);
    for w in path.windows(2) {
        let (d, t, _) = g::distance(c, w[0], w[1]);
        if d < best {
            best = d;
            at = s + t * dist(w[0], w[1]);
        }
        s += dist(w[0], w[1]);
    }
    let from = (at - budget * 0.5).clamp(0.0, (total - budget).max(0.0));
    sub_path(path, from, from + budget)
}
pub(super) fn sub_path(path: &[Point], from: f64, to: f64) -> Vec<Point> {
    let mut out = vec![];
    let mut s = 0.0;
    for w in path.windows(2) {
        let l = dist(w[0], w[1]);
        let (a, b) = (s, s + l);
        if b >= from && a <= to && l > 1e-9 {
            let p = super::super::point(w[0], w[1], ((from - a) / l).clamp(0.0, 1.0));
            let q = super::super::point(w[0], w[1], ((to - a) / l).clamp(0.0, 1.0));
            if out.is_empty() {
                out.push(p);
            }
            if dist(*out.last().unwrap(), q) > 1e-6 {
                out.push(q);
            }
        }
        s = b;
    }
    out
}

/// `path` with a vertex at least every `step` metres (its own vertices kept).
pub(super) fn densify(path: &[Point], step: f64) -> Vec<Point> {
    let mut out: Vec<Point> = path.first().copied().into_iter().collect();
    for w in path.windows(2) {
        let k = (dist(w[0], w[1]) / step).ceil().max(1.0) as usize;
        out.extend((1..=k).map(|i| super::super::point(w[0], w[1], i as f64 / k as f64)));
    }
    out
}

/// Share of a quay line with drawn water (`Surface::wet`, the shoreline the
/// renderer draws) beside it, within its half width, two raster cells and
/// 12 m, sampled every 8 m. A quay is laid on the waterline: one standing
/// back from the water (a re-traced or displaced front, a quarter edge
/// short of the shore) is no quay.
pub(super) fn touching(surface: Surface<'_>, path: &[Point], half: f64) -> f64 {
    let total = length(path);
    if total <= 1e-6 {
        return 0.0;
    }
    let reach = half + 2.0 * surface.width / surface.n as f64 + 12.0;
    let samples = (total / 8.0).ceil().max(2.0) as usize;
    let (mut hit, mut seen) = (0, 0);
    for k in 0..=samples {
        let at = sub_path(path, 0.0, (total * k as f64 / samples as f64).max(0.5));
        let (Some(&p), Some(&q)) = (at.last(), at.get(at.len().saturating_sub(2))) else { continue };
        if dist(p, q) < 1e-9 {
            continue;
        }
        let n = left(unit(q, p));
        seen += 1;
        let wet = |side: f64| (1..=(2.0 * reach).ceil() as usize).any(|j| surface.wet(add(p, n, side * 0.5 * j as f64)));
        if wet(1.0) || wet(-1.0) {
            hit += 1;
        }
    }
    if seen == 0 { 0.0 } else { hit as f64 / seen as f64 }
}

/// The stretches of `path` farther than `clearance` from every quay already
/// laid, each at least `min` long. One shore carries one quay: never two
/// stacked strokes (a front re-traced over an inherited quay, the runs of two
/// quarters meeting at a corner, a sea and a river front at a mouth).
pub(super) fn unlaid(path: &[Point], laid: &[Vec<Point>], clearance: f64, min: f64) -> Vec<Vec<Point>> {
    let near = |p: Point| laid.iter().any(|q| q.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < clearance));
    let dense = densify(path, 2.0);
    if !dense.iter().any(|&p| near(p)) {
        return vec![path.to_vec()];
    }
    let (mut out, mut run) = (vec![], vec![]);
    for p in dense.into_iter().chain([Point { x: f64::NAN, y: f64::NAN }]) {
        if p.x.is_finite() && !near(p) {
            run.push(p);
        } else if run.len() >= 2 && length(&run) >= min {
            out.push(g::simplify(&std::mem::take(&mut run), 0.4, |_| false));
        } else {
            run.clear();
        }
    }
    out
}

/// A quay line without self-crossings: where an offset run folds over itself
/// (a tight cove, a corner of two quarters), the loop is cut out and the line
/// goes straight across it, as a quay is built over a small indentation.
pub(super) fn untangled(mut path: Vec<Point>) -> Vec<Point> {
    'again: loop {
        let k = path.len();
        for i in 0..k.saturating_sub(1) {
            for j in i + 2..k.saturating_sub(1) {
                if let Some((_, cut)) = g::segment_hit(path[i], path[i + 1], path[j], path[j + 1]) {
                    let mut joined: Vec<Point> = path[..=i].to_vec();
                    joined.push(cut);
                    joined.extend_from_slice(&path[j + 1..]);
                    joined.dedup_by(|a, b| dist(*a, *b) < 1e-6);
                    path = joined;
                    continue 'again;
                }
            }
        }
        return path;
    }
}

/// Landing streets from a quay to the nearest town street, about every
/// 120 m and at least one; their junctions become quay vertices. `None` when
/// no landing street can be laid (the quay would be cut off).
pub(super) fn landing_streets(
    path: &mut Vec<Point>,
    streets: &[Street],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
) -> Option<Vec<Street>> {
    const EVERY: f64 = 120.0;
    let total = length(path);
    let town: Vec<Street> = streets
        .iter()
        .filter(|s| s.role != "quay" && s.path.len() >= 2)
        .cloned()
        .collect();
    if town.is_empty() {
        return None;
    }
    let stations = (total / EVERY).ceil().max(1.0) as usize;
    let mut links = vec![];
    let mut joints: Vec<(f64, Point)> = vec![];
    for k in 0..stations {
        // Try the station and points around it within its share of the quay.
        let base = total * (k as f64 + 0.5) / stations as f64;
        let span = total / stations as f64 * 0.45;
        let found = (0..9).find_map(|j| {
            let off = span * [0.0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1.0, -1.0][j];
            let s = (base + off).clamp(0.0, total);
            let p = sub_path(path, 0.0, s).last().copied().unwrap_or(path[0]);
            let (d, q, _) = super::super::nearest(p, &town)?;
            (d < 80.0 && (d <= 1.0 || routing::segment_clear(surface, p, q, cfg.max_street_grade)))
                .then_some((s, p, q, d))
        });
        if let Some((s, p, q, d)) = found {
            joints.push((s, p));
            if d > 1.0 {
                links.push(Street {
                    path: vec![p, q],
                    widths: vec![4.0; 2],
                    rank: 2,
                    role: "street".into(),
                });
            }
        }
    }
    if joints.is_empty() {
        return None;
    }
    // Insert the junctions as quay vertices, from the far end so indices hold.
    joints.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (s, p) in joints {
        let mut acc = 0.0;
        for i in 0..path.len() - 1 {
            let l = dist(path[i], path[i + 1]);
            if s <= acc + l + 1e-9 {
                if dist(p, path[i]) > 1e-6 && dist(p, path[i + 1]) > 1e-6 {
                    path.insert(i + 1, p);
                }
                break;
            }
            acc += l;
        }
    }
    Some(links)
}

/// Piers, landing stages and moles from the quays of a finished street
/// network. A pier stands square to its quay every `pier_spacing` (denser in
/// a larger port), wholly over water with open water beyond it, never across
/// another street or bridge; on rivers and canals, and in small or lagoon
/// towns, it is a short landing stage that leaves the channel free (water at
/// least three stage lengths wide beyond it). A sea port of 6 000 people or
/// more whose culture builds basins gets two moles enclosing a basin in front
/// of its longest straight quay, when both stand on water.
pub(in super::super::super) fn works(
    streets: &[Street],
    surface: Surface<'_>,
    site: &Site,
    culture: &str,
) -> Vec<Street> {
    works_with_minimum(streets,surface,site,culture,40.0,true)
}

/// `moles`: whether the port may build its pair of moles (a sheltered basin).
pub(super) fn works_with_minimum(streets: &[Street], surface: Surface<'_>, site: &Site, culture: &str, minimum: f64, moles: bool) -> Vec<Street> {
    let h = params(culture);
    let quays: Vec<&Street> = streets
        .iter()
        .filter(|s| s.role == "quay" && s.path.len() >= 2)
        .collect();
    if quays.is_empty() {
        return vec![];
    }
    let population = f64::from(site.population.max(1));
    let small = population < 3000.0 || h.fondamenta;
    let spacing = h.pier_spacing * (10_000.0 / population).sqrt().clamp(0.6, 1.8);
    let limit = ((population / 1500.0).ceil() as usize).clamp(1, 40);
    let segments: Vec<(Point, Point)> = streets
        .iter()
        .flat_map(|s| s.path.windows(2).filter(|w| matches!(s.role.as_str(),"pier"|"boardwalk"|"mole"|"landing"|"bridge"|"causeway")
            || surface.wet(super::super::point(w[0],w[1],0.5))).map(|w| (w[0], w[1])))
        .collect();
    let crosses = |a: Point, b: Point, own: &[(Point, Point)]| {
        segments
            .iter()
            .chain(own.iter())
            .any(|&(c, d)| g::segment_hit(a, b, c, d).is_some_and(|(t, _)| t > 0.05))
    };
    // Open water from `p` along `n` over `[from, to]`, every 2 m.
    let open = |p: Point, n: Point, from: f64, to: f64, kind: u8| {
        let m = ((to - from) / 2.0).ceil().max(1.0) as usize;
        (0..=m).all(|k| {
            let q = add(p, n, from + (to - from) * k as f64 / m as f64);
            let c = code(surface, q);
            c != 0 && (c == kind || kind != 3 && c != 3)
        })
    };
    let mut out: Vec<Street> = vec![];
    let mut own: Vec<(Point, Point)> = vec![];
    let mut roots: Vec<Point> = vec![];
    // Moles first: they claim the best front.
    if moles && (h.basin || !h.fondamenta) && !small && population >= 6000.0 {
        let best = quays
            .iter()
            .filter(|q|front_water(surface,&q.path).is_some_and(|(kind,_)|kind=="sea"))
            .map(|q| (q, dist(q.path[0], *q.path.last().unwrap())))
            .filter(|(q, chord)| *chord >= (population.sqrt()*0.5).clamp(40.0,100.0) && *chord >= 0.85 * length(&q.path))
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((q, chord)) = best {
            let (a, b) = (q.path[0], *q.path.last().unwrap());
            let w = q.widths.first().copied().unwrap_or(6.0) * 0.5;
            let t = unit(a, b);
            let n = [left(t), Point { x: t.y, y: -t.x }]
                .into_iter()
                .filter_map(|n| (0..=(2.0*surface.width/surface.n as f64+20.0).ceil() as usize)
                    .map(|k|w+0.5+k as f64).find(|&d|code(surface,add(super::super::point(a,b,0.5),n,d))==1).map(|d|(d,n)))
                .min_by(|a,b|a.0.total_cmp(&b.0)).map(|(_,n)|n);
            if let Some(n) = n {
                let reach = (0.35 * chord).clamp(40.0, 160.0);
                let arm = 0.3 * chord;
                let start = |p| (0..=(2.0 * surface.width / surface.n as f64 + 20.0).ceil() as usize)
                    .map(|k| w + 0.5 + k as f64).find(|&d| code(surface, add(p, n, d)) == 1);
                if let (Some(da), Some(db)) = (start(a), start(b)) {
                let a0 = add(a, n, da);
                let b0 = add(b, n, db);
                let a1 = add(a0, n, reach);
                let b1 = add(b0, n, reach);
                let a2 = add(a1, t, arm);
                let b2 = add(b1, t, -arm);
                let wet = |p: Point, q: Point| open(p, unit(p, q), 0.0, dist(p, q), 1);
                let sea = |p: Point| code(surface, p) == 1;
                if sea(add(a0, n, 4.0))
                    && sea(add(b0, n, 4.0))
                    && wet(add(a0, n, 4.0), a1)
                    && wet(a1, a2)
                    && wet(add(b0, n, 4.0), b1)
                    && wet(b1, b2)
                    && !crosses(a, a2, &own)
                    && !crosses(b, b2, &own)
                {
                    for path in [vec![a, a1, a2], vec![b, b1, b2]] {
                        own.extend(path.windows(2).map(|w| (w[0], w[1])));
                        roots.push(path[0]);
                        out.push(Street {
                            widths: vec![(population.sqrt() * 0.08).clamp(3.0, 12.0); path.len()],
                            path,
                            rank: 2,
                            role: "mole".into(),
                        });
                    }
                }
                }
            }
        }
    }
    let mut piers = 0;
    for q in &quays {
        let w = q.widths.first().copied().unwrap_or(6.0) * 0.5;
        let total = length(&q.path);
        // Every quay of 40 m or more has at least one pier or landing stage.
        let stations = (total / spacing)
            .floor()
            .max(if total >= minimum { 1.0 } else { 0.0 }) as usize;
        for k in 0..stations {
            if piers >= limit {
                break;
            }
            let s = total * (k as f64 + 0.5) / stations as f64;
            let near = sub_path(&q.path, 0.0, s);
            let (Some(&p), Some(&prev)) = (near.last(), near.get(near.len().saturating_sub(2)))
            else {
                continue;
            };
            if dist(p, prev) < 1e-6 || roots.iter().any(|&r| dist(r, p) < spacing * 0.6) {
                continue;
            }
            let t = unit(prev, p);
            // The water side and where its water begins (the quay edge, or a
            // raster step beyond it).
            let Some((n, kind, d0)) =
                [left(t), Point { x: t.y, y: -t.x }]
                    .into_iter()
                    .find_map(|n| {
                        (0..=(2.0 * surface.width / surface.n as f64 + 20.0).ceil() as usize).map(|k| w + 0.5 + k as f64).find_map(|d| {
                            let c = code(surface, add(p, n, d));
                            (c != 0).then_some((n, c, d))
                        })
                    })
            else {
                continue;
            };
            let landing = small || kind == 3;
            let wanted = if landing {
                (h.pier_length.0 * 0.5).clamp(6.0, 14.0)
            } else {
                let x = ((population - 3000.0) / 30_000.0).clamp(0.0, 1.0);
                h.pier_length.0 + (h.pier_length.1 - h.pier_length.0) * x
            };
            // The longest admissible length down to two thirds of the wanted
            // one: open water along it and beyond (a free channel). A river
            // landing reaches at most a fifth of the river: a stage along a
            // narrow river, never a pier across it.
            let beyond = |l: f64| if kind == 3 { 4.0 * l } else if landing { 2.0 * l } else { 20.0 };
            let Some(l) = [1.0, 0.85, 0.67]
                .iter()
                .map(|f| wanted * f)
                .find(|&l| open(p, n, d0, d0 + l + beyond(l), kind))
            else {
                continue;
            };
            let end = add(p, n, d0 + l);
            if crosses(add(p, n, w + 0.5), end, &own) {
                continue;
            }
            // The head stands in open water of its own kind on both sides, as
            // far as the pier is long: a pier from the corner of a river mouth
            // would reach into the other water or across the mouth.
            let reach = l.max(8.0);
            if !(open(end, t, 0.0, reach, kind) && open(end, Point { x: -t.x, y: -t.y }, 0.0, reach, kind)) {
                continue;
            }
            own.push((p, end));
            roots.push(p);
            piers += 1;
            out.push(Street {
                path: vec![p, end],
                widths: vec![if landing { 3.0 } else { 5.0 }; 2],
                rank: 3,
                role: if landing { "landing" } else { "pier" }.into(),
            });
        }
    }
    out
}

pub(in super::super::super) fn configured_works(streets: &[Street], surface: Surface<'_>, site: &Site, culture: &str, cfg: &LayoutConfig) -> Vec<Street> {
    let out = if parameterized(cfg) {shelter::works(streets,surface,site,culture)}
    else {works(streets,surface,site,culture)};
    budgeted_works(out, site, culture, cfg)
}

/// `configured_works` for a town with its own seed (the one its quarters are
/// laid with): the harbour type drawn for the town (`harbour_furniture`)
/// decides whether the port keeps its pair of moles; without them the
/// piers take the whole front. Requested port parameters (detachment,
/// shelter) and `port_type: bare` keep the works above.
pub(in super::super::super) fn typed_works(seed: &str, streets: &[Street], surface: Surface<'_>, site: &Site, culture: &str, cfg: &LayoutConfig) -> Vec<Street> {
    if parameterized(cfg) || super::super::super::harbour_furniture::keeps_moles(seed, culture, site.population, &cfg.port_type, streets, surface) {
        return configured_works(streets, surface, site, culture, cfg);
    }
    budgeted_works(works_with_minimum(streets, surface, site, culture, 40.0, false), site, culture, cfg)
}

fn budgeted_works(mut out: Vec<Street>, site: &Site, culture: &str, cfg: &LayoutConfig) -> Vec<Street> {
    {
        // One pier or mole per ~80 m of the port's quay budget (its demand).
        let budget = quay_budget(site, cfg, params(culture));
        let limit = if budget.is_finite() { ((budget / 80.0).ceil() as usize).clamp(1, 20) } else { 20 };
        out.retain(|s| site.population >= 3000 || s.role != "mole");
        out.truncate(limit);
        if site.population < 1000 {
            for s in &mut out { s.path = sub_path(&s.path, 0.0, 12.0); s.widths = vec![3.0; s.path.len()]; s.role = "landing".into(); }
        }
    }
    out
}
