//! Fortification history, gate crossings, and town curtain geometry.

use super::*;

/// Polygonal curtain fitted to a growth outline: straight runs between corners,
/// at most ~2 % of the town's width away from the land it encloses, and never
/// following the stair steps of the terrain raster along a bank.
/// Pieces of one town that only a river or a stream separates share one
/// circuit. A closing of the pieces (reach `WATER_REACH`) finds the narrow gaps
/// between them; a gap that is mostly water (the river and its banks) joins
/// the enclosure, so the curtain crosses the water on water gates instead of
/// running along both banks. Dry land between the arms is never enclosed.
const WATER_REACH: f64 = 60.0;
/// Morphological closing (grow then shrink by `reach`). geo's offset never
/// ends on a ring with long runs of millimetre zigzag edges (a 150k
/// persian+medina outline carried 1236 edges under 5 cm along 6 m); the
/// closing only looks for gaps metres wide, so it drops sub-centimetre detail.
pub(in crate::urban) fn closing(shapes: &geo::MultiPolygon<f64>, reach: f64) -> geo::MultiPolygon<f64> {
    use geo::{Buffer, Simplify};
    shapes.simplify(0.01).buffer(reach).buffer(-reach)
}
fn across_water(pieces: Vec<Shape>, surface: Surface<'_>) -> Vec<Shape> {
    use geo::{BooleanOps, MultiPolygon};
    if pieces.len() < 2 {
        return pieces;
    }
    let town = MultiPolygon(pieces.iter().map(g::polygon).collect());
    let closed = closing(&town, WATER_REACH);
    let wet_gaps: Vec<Shape> = g::shapes(closed.difference(&town))
        .into_iter()
        .filter(|gap| {
            let area = g::area(gap);
            area > 50.0 && {
                let dry: f64 = g::dry_clip(&surface, gap).iter().map(g::area).sum();
                area - dry >= 0.25 * area
            }
        })
        .collect();
    if wet_gaps.is_empty() {
        return pieces;
    }
    union(&pieces.into_iter().chain(wet_gaps).collect::<Vec<_>>())
}
/// Bank points of a closed curtain path where it passes from land to water, in
/// path order, each with `true` when the curtain enters the water there.
pub(in crate::urban) fn water_gates(path: &[Point], surface: Surface<'_>) -> Vec<(Point, bool)> {
    let step = (surface.width / surface.n.max(1) as f64 * 0.5).clamp(1.0, 4.0);
    let mut out = vec![];
    for w in path.windows(2) {
        let (a, b) = (w[0], w[1]);
        let l = (b.x - a.x).hypot(b.y - a.y);
        let k = (l / step).ceil().max(1.0) as usize;
        let at = |i: usize| Point {
            x: a.x + (b.x - a.x) * i as f64 / k as f64,
            y: a.y + (b.y - a.y) * i as f64 / k as f64,
        };
        let mut was = surface.wet(a);
        for i in 1..=k {
            let p = at(i);
            let now = surface.wet(p);
            if now != was {
                // The bank itself, within half a metre, on its dry side: a water gate spans the
                // water and no more, and its abutments get the whole bank.
                let (mut dry, mut wet) = if now { (at(i - 1), p) } else { (p, at(i - 1)) };
                for _ in 0..3 {
                    let mid = Point { x: (dry.x + wet.x) * 0.5, y: (dry.y + wet.y) * 0.5 };
                    if surface.wet(mid) { wet = mid } else { dry = mid }
                }
                out.push((dry, now));
            }
            was = now;
        }
    }
    out
}
fn curtain(shape: &Shape, cell: f64, small: bool) -> Shape {
    if small { fortification::village_trace(shape, cell, false) }
    else { fortification::curtain_trace(shape) }
}

/// A harbour stands outside the walls of its town unless it is asked inside. A canal town keeps its
/// harbour inside: its water is its street network, and its canals pass the curtain at their mouths.
fn harbour_inside(culture: &str, cfg: &LayoutConfig) -> bool {
    cfg.port_enclosure == "inside" || matches!(cfg.port_enclosure.as_str(), "" | "auto") && crate::urban::lagoon::canal_town(culture, cfg)
}
/// The harbour fronts of a laid plan, as its walls met them when they were traced.
pub(in crate::urban) fn harbour_fronts(layout: &super::super::Layout) -> Vec<Shape> {
    let inside = layout.config.as_ref().is_some_and(|cfg| harbour_inside(&layout.culture, cfg));
    let mut fronts = macroplan::harbour::fronts(&layout.streets, inside, &layout.culture, 0.0);
    if layout.config.as_ref().is_some_and(|cfg| crate::urban::lagoon::canal_town(&layout.culture, cfg)) {
        let rings: Vec<Shape> = layout.enclosures.iter().filter(|e| e.purpose.is_empty() && e.path.len() >= 4).map(closed_shape).collect();
        fronts.extend(water_side(&rings));
    }
    fronts
}
/// A canal town stands on its water: its canals open on the shore through the curtain, so every circuit
/// counts as a quay kept inside, a thin harbour front along its foot, and leaves no beach.
fn water_side(rings: &[Shape]) -> Vec<Shape> {
    use geo::Buffer;
    let grown = |s: &Shape, d: f64| std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(g::polygon(s).buffer(d)))).unwrap_or_default();
    rings.iter().flat_map(|ring| {
        let plain = Shape { outer: ring.outer.clone(), holes: vec![] };
        let foot = grown(&plain, 1.0);
        grown(&plain, 2.0).into_iter().flat_map(|s| foot.iter().fold(vec![s], |rest, f| rest.iter().flat_map(|s| g::difference(s, f)).collect())).collect::<Vec<_>>()
    }).collect()
}
/// Ground (m) the works of a curtain take in front of it: its outer half, the berm and the ditch.
fn works_depth(curtain: f64, ditch: f64) -> f64 {
    (curtain * 0.5 + ditch + 4.0).min(16.0)
}
/// Half the widest gap (m) between two town circuits that stand side by side.
const JOIN_REACH: f64 = 40.0;
/// Two town circuits side by side are one circuit. Where their rings run
/// within `2 × JOIN_REACH` of each other (without overlapping, nesting or
/// sharing a stretch, as an attached extension does), the land between them
/// joins the enclosure and a single curtain runs round both, inside the land
/// they held together. The joined circuit carries no works yet:
/// `fortification::settle` builds it.
pub(in crate::urban) fn join_side_by_side(layout: &mut super::super::Layout, surface: Surface<'_>) {
    use geo::{BooleanOps, Buffer, MultiPolygon};
    let town = |e: &Enclosure| e.purpose.is_empty() && e.path.len() >= 4;
    let grown = |s: &Shape, d: f64| std::panic::catch_unwind(std::panic::AssertUnwindSafe(||
        g::shapes(g::polygon(s).buffer(d)))).unwrap_or_default();
    // A pair refused once is refused again while neither circuit changes:
    // circuits carry ids, a join gives the merged one a new id.
    let harbour = harbour_fronts(layout);
    let mut ids: Vec<usize> = (0..layout.enclosures.len()).collect();
    let mut fresh = ids.len();
    let mut refused: std::collections::HashSet<(usize, usize)> = Default::default();
    loop {
        let n = layout.enclosures.len();
        let mut joined = None;
        'pairs: for i in 0..n {
            for j in i + 1..n {
                if !refused.insert((ids[i], ids[j])) { continue; }
                let (a, b) = (&layout.enclosures[i], &layout.enclosures[j]);
                if !town(a) || !town(b) { continue; }
                let (sa, sb) = (closed_shape(a), closed_shape(b));
                let ((ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1)) = (g::bbox(&sa), g::bbox(&sb));
                let reach = 2.0 * JOIN_REACH;
                if ax0 > bx1 + reach || bx0 > ax1 + reach || ay0 > by1 + reach || by0 > ay1 + reach { continue; }
                // Nested circuits (an older wall) or ones sharing a stretch stay apart;
                // two that merely touch at a corner are side by side.
                let overlap: f64 = g::intersection(&sa, &sb).iter().map(g::area).sum();
                if overlap > 0.25 * g::area(&sa).min(g::area(&sb))
                    || fortification::shared_length(&sa, &sb) >= 3.0 { continue; }
                let pair = MultiPolygon(union(&[sa.clone(), sb.clone()]).iter().map(g::polygon).collect());
                let Ok(closing) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(||
                    pair.buffer(JOIN_REACH).buffer(-JOIN_REACH))) else { continue; };
                let (na, nb) = (grown(&sa, 1.0), grown(&sb, 1.0));
                let touches = |gap: &Shape, near: &[Shape]| near.iter().any(|s| !g::intersection(gap, s).is_empty());
                let gaps: Vec<Shape> = g::shapes(closing.difference(&pair)).into_iter()
                    .filter(|gap| g::area(gap) > 50.0 && touches(gap, &na) && touches(gap, &nb)).collect();
                // The two banks of a water no gate spans stay two circuits.
                if fortification::parted_by_water(&gaps, surface) { continue; }
                let banks = [sa.clone(), sb.clone()];
                let merged = union(&[sa, sb].into_iter().chain(gaps).collect::<Vec<_>>());
                let [one] = merged.as_slice() else { continue; };
                let joined_land = Shape { outer: one.outer.clone(), holes: vec![] };
                // Rounding the joined outline takes no land outside the two circuits and the gap
                // between them (a neighbour's claim); a bend that turns into the town is then run
                // straight across, as on any trace. A join that does not hold is refused and both
                // circuits stay as they were.
                let rounded = fortification::curtain_trace(&joined_land);
                let Some(kept) = g::intersection(&rounded, &joined_land).into_iter().max_by(|x, y| g::area(x).total_cmp(&g::area(y))) else { continue; };
                let trace = fortification::straight_across(&g::normalized(Shape { outer: kept.outer, holes: vec![] }), surface);
                if trace.outer.len() < 3 || !g::simple(&trace) || g::area(&trace) < 0.9 * g::area(&joined_land) { continue; }
                // The joined circuit obeys the water rule as one ring (a channel between the two is
                // crossed on water gates), or the two stay apart, each on its bank.
                let Ok([trace]) = <[Shape; 1]>::try_from(fortification::kept_fronts(vec![trace], &banks, &harbour, surface, 0.0)) else { continue; };
                let kind = if g::area(&closed_shape(a)) >= g::area(&closed_shape(b)) { a.kind.clone() } else { b.kind.clone() };
                joined = Some((i, j, trace, kind));
                break 'pairs;
            }
        }
        let Some((i, j, trace, kind)) = joined else { break; };
        let path = closed(&trace.outer);
        layout.enclosures.remove(j);
        layout.enclosures.remove(i);
        ids.remove(j);
        ids.remove(i);
        ids.insert(i, fresh);
        fresh += 1;
        let gates = gates(&path, &layout.streets);
        layout.enclosures.insert(i, Enclosure { gates, path, kind, ..Default::default() });
    }
}
/// Runs of a closed path that are dry and within street grade, at least 80 m
/// long. A fully clear ring is returned whole.
fn dry_runs(path: &[Point], surface: Surface<'_>, grade: f64) -> Vec<Vec<Point>> {
    let clear: Vec<bool> = path
        .windows(2)
        .map(|w| {
            routing::segment_clear(surface, w[0], w[1], grade)
                && !surface.wet(Point {
                    x: (w[0].x + w[1].x) * 0.5,
                    y: (w[0].y + w[1].y) * 0.5,
                })
        })
        .collect();
    if clear.iter().all(|&c| c) {
        return vec![path.to_vec()];
    }
    let n = clear.len();
    // Start after a blocked segment so a run never wraps around the seam.
    let Some(start) = (0..n).find(|&i| !clear[i]) else {
        return vec![];
    };
    let mut runs = vec![];
    let mut run: Vec<Point> = vec![];
    for k in 1..=n {
        let i = (start + k) % n;
        if clear[i] {
            if run.is_empty() {
                run.push(path[i]);
            }
            run.push(path[i + 1]);
        } else if !run.is_empty() {
            runs.push(std::mem::take(&mut run));
        }
    }
    if !run.is_empty() {
        runs.push(run);
    }
    runs.retain(|r| length(r) >= 80.0);
    runs
}
pub(super) fn closed_shape(e: &Enclosure) -> Shape {
    let mut outer = e.path.clone();
    outer.pop();
    Shape { outer, holes: vec![] }
}
pub(super) fn closed(ring: &[Point]) -> Vec<Point> {
    let mut path = ring.to_vec();
    if let Some(&p) = path.first() {
        path.push(p);
    }
    path
}
/// Gates are the real crossings of the network with the curtain: a street
/// passing through it, or street ends meeting on it from both sides. A street
/// that only ends on the curtain (a lane run up to the wall) opens no gate.
pub(in crate::urban) fn gates(path: &[Point], streets: &[Street]) -> Vec<Point> {
    const THROUGH: u8 = 3;
    let d = |a: Point, b: Point| (a.x - b.x).hypot(a.y - b.y);
    // (point, sides): 1 and 2 are the two sides of the curtain a street end
    // comes from; a through crossing holds both.
    let mut hits: Vec<(Point, u8)> = vec![];
    // Curtain segments on a grid: each street segment tests the few it passes.
    let near = fortification::Near::new(path, 40.0);
    for st in streets.iter().filter(|s| s.role != "wall-lane") {
        let n = st.path.len();
        if n < 2 {
            continue;
        }
        for (i, w) in st.path.windows(2).enumerate() {
            for k in near.crossed(w[0], w[1]) {
                let e = [path[k], path[k + 1]];
                if let Some((_, p)) = g::segment_hit(w[0], w[1], e[0], e[1]) {
                    let terminal = i == 0 && d(st.path[0], p) < 0.5
                        || i + 2 == n && d(st.path[n - 1], p) < 0.5;
                    if !terminal {
                        hits.push((p, THROUGH));
                    }
                }
            }
        }
        // Street ends on the curtain, with the side their body lies on.
        for (q, body) in [(st.path[0], st.path[1]), (st.path[n - 1], st.path[n - 2])] {
            for k in near.crossed(q, q) {
                let (a, b) = (path[k], path[k + 1]);
                if g::distance(q, a, b).0 < 0.5 {
                    let side = (b.x - a.x) * (body.y - a.y) - (b.y - a.y) * (body.x - a.x);
                    if side.abs() > 1e-9 {
                        hits.push((q, if side > 0.0 { 1 } else { 2 }));
                    }
                    break;
                }
            }
        }
    }
    let mut gates: Vec<(Point, u8)> = vec![];
    for (p, sides) in hits {
        match gates.iter_mut().find(|q| d(q.0, p) < 8.0) {
            Some(q) => q.1 |= sides,
            None => gates.push((p, sides)),
        }
    }
    gates
        .into_iter()
        .filter(|q| q.1 == THROUGH)
        .map(|q| q.0)
        .collect()
}
/// Fortification history of the modern path. The enceinte encloses the founding
/// epochs only; the youngest growth stays outside the gates as faubourgs. An
/// older circuit becomes a ring boulevard (`fossil: street`) or stays as an inner
/// wall (`fossil: wall`). Quarters are split along both lines, so tissue streets
/// never cross a curtain and gates are the real crossings of the main network.
#[allow(clippy::too_many_arguments)]
pub(super) fn fortify(
    plan: &mut macroplan::Plan,
    phases: &mut [GrowthPhase],
    culture: &str,
    site: &Site,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    morph: &Morph,
    small: bool,
    metropolis: bool,
) -> (Vec<Point>, Vec<Street>) {
    let profile = profiles::settlement_profile(culture, site.population, cfg.phases);
    let kind = profiles::fortification(profile, &cfg.fortification, site.population);
    if !matches!(kind, "wall" | "palisade" | "hedge") || phases.is_empty() {
        return (vec![], vec![]);
    }
    let epochs = phases.len();
    // A planned walled culture (square or rectangular founding plan, `wall`)
    // supersedes the faubourg rule: its rectangle is the walled city, every
    // epoch inside, each older epoch keeping its own circuit.
    let enclosure = &culture_data(culture, site.population)["core"]["enclosure"];
    let planned = matches!(enclosure["shape"].as_str(), Some("square" | "rect"))
        && enclosure["wall"].as_str() == Some("wall");
    let cardinal = enclosure["orientation"].as_str() == Some("cardinal");
    let force_rect = cfg.planned_wall == "rect";
    let walled = if small || epochs == 1 || planned {
        epochs
    } else {
        epochs - 1
    };
    let cell = surface.width / surface.n as f64;
    // A square circuit runs on the axes of the grid it encloses; a cardinal
    // grid keeps the exact compass.
    let grid = grid_frame(&plan.quarters)
        .map(|a| if cardinal && a.abs() < 3f64.to_radians() { 0.0 } else { a });
    let mut outlines = std::collections::BTreeMap::new();
    // `trace`: "" (straight runs between corners), "hill" (contour trace) or
    // "bastioned" (long fronts between salients; `None` where it cannot fit).
    let mut enclosed = |count: usize, trace: &str| {
        let outline = outlines.entry(count).or_insert_with(|| {
            across_water(
                union(
                    &phases[..count]
                        .iter()
                        .flat_map(|p| p.shapes.clone())
                        .collect::<Vec<_>>(),
                ),
                surface,
            )
        });
        // A hamlet-sized outlier gets no circuit of its own.
        outline
            .iter()
            .filter(|s| g::area(s) > 15_000.0)
            .map(|s| match trace {
                "hill" => Some(if small { fortification::village_trace(s, cell, true) }
                    else { fortification::hill_trace(s, cell) }),
                "bastioned" => fortification::bastioned_trace(&curtain(s, cell, small), surface),
                // A planned city's square circuit, where its land allows one.
                "square" => {
                    let base = curtain(s, cell, small);
                    Some(fortification::square_trace(&base, surface, cardinal, force_rect, grid).unwrap_or(base))
                }
                _ => Some(curtain(s, cell, small)),
            })
            .collect::<Option<Vec<_>>>()
    };
    let Some(walls) = enclosed(walled, "") else {
        return (vec![], vec![]);
    };
    if walls.is_empty() {
        return (vec![], vec![]);
    }
    // Style inside the kind: culture, population, period, site and relief
    // (`fortification::resolve`); the trace then follows the style.
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    let mut laps = crate::urban::profile::Lap::new("fortify");
    let base = Rng::new(&site.key).fork("fortification");
    let (relief, wet_share) = fortification::terrain(&walls, surface);
    let mut style = fortification::resolve(
        kind,
        &fortification::Inputs {
            culture,
            pop: site.population,
            period: &cfg.programme.period,
            state: &cfg.programme.state,
            archetype: &cfg.site_archetype,
            forced: &cfg.fortification_style,
            relief,
        },
        &base,
        &mut plan.warnings,
    );
    // Planned cultures (square or rectangular founding plan) on a regular
    // trace keep a square circuit.
    let square = cfg.planned_wall != "follow" && (force_rect || !style.hill)
        && (planned || style.id == "wengcheng"
            && matches!(enclosure["shape"].as_str(), Some("square" | "rect")));
    let walls = if style.hill {
        enclosed(walled, "hill").unwrap_or(walls)
    } else if square {
        enclosed(walled, "square").unwrap_or(walls)
    } else if style.id == "bastioned" {
        match enclosed(walled, "bastioned") {
            Some(traced) => traced,
            None => {
                plan.warnings.push(warnings::flanked_wall());
                let (hill, forced) = (style.hill, style.forced);
                style = fortification::resolve(
                    kind,
                    &fortification::Inputs {
                        culture,
                        pop: site.population,
                        period: &cfg.programme.period,
                        state: &cfg.programme.state,
                        archetype: &cfg.site_archetype,
                        forced: "flanked",
                        relief: 0.0,
                    },
                    &base,
                    &mut vec![],
                );
                style.hill = hill;
                style.forced = forced;
                walls
            }
        }
    } else {
        walls
    };
    let walls = fortification::trace_enclosures(walls, &plan.quarters.iter()
        .map(|q| q.shape.clone()).collect::<Vec<_>>(), surface);
    let walls = walls.into_iter().map(|s| fortification::parameter_trace(s, surface, cfg, culture, style.curtain_width)).collect::<Vec<_>>();
    laps.lap("trace");
    // The harbour of a walled port is decided before its walls, on the shore they reach.
    let yards = macroplan::harbour::town_port(&mut plan.quarters, &mut plan.streets, &walls, surface, cfg, site, culture, morph, harbour_inside(culture, cfg));
    laps.lap("town_port");
    // Walls against water are decided here, on the trace, with the quays the plan already laid:
    // every circuit is a closed ring on dry land behind its wall walk, the harbour outside unless
    // it is asked inside. Nothing later opens the curtain for the water.
    let founding: Vec<Shape> = plan.quarters.iter().map(|q| q.shape.clone()).collect();
    let mut harbour = macroplan::harbour::fronts(&plan.streets, harbour_inside(culture, cfg), culture, works_depth(style.curtain_width, style.ditch_width[1]));
    if crate::urban::lagoon::canal_town(culture, cfg) {
        harbour.extend(water_side(&walls));
    }
    let dry = |walls: Vec<Shape>, width: f64| fortification::water_fronts(walls, &founding, &harbour, surface, width - fortification::ribbon_half(kind));
    let walls = dry(walls, style.curtain_width);
    laps.lap("water_fronts");
    // Lopsided growth builds the second enclosure against the old one: the old
    // circuit stays whole and the extension shares a stretch of it.
    let trace = if style.hill { "hill" } else if square { "square" } else if style.id == "bastioned" { "bastioned" } else { "" };
    let extension = fortification::wall_extension(cfg, culture);
    let mut attached = false;
    let walls = match (extension != "concentric" && walled >= 2 && walls.len() == 1)
        .then(|| enclosed(walled - 1, trace).filter(|o| o.len() == 1)).flatten()
    {
        Some(old) => {
            let quarters: Vec<Shape> = plan.quarters.iter().map(|q| q.shape.clone()).collect();
            let old = fortification::trace_enclosures(old, &quarters, surface);
            let old = old.first().map(|o| fortification::parameter_trace(o.clone(), surface, cfg, culture, style.curtain_width));
            match old {
                Some(o) if extension == "attached" || fortification::lopsided(&o, &walls[0]) => {
                    // The old circuit obeys the water rule like the new one, as one ring.
                    let o = dry(vec![o], style.curtain_width);
                    let pair = match o.as_slice() {
                        [old] => fortification::attach(old, &walls[0]).map(|e| vec![old.clone(), e]),
                        _ => None,
                    };
                    match pair {
                        Some(pair) => { attached = true; pair }
                        None => {
                            plan.warnings.push(warnings::concentric_wall());
                            walls
                        }
                    }
                }
                _ => walls,
            }
        }
        None => {
            if extension == "attached" && walled >= 2 {
                plan.warnings.push(warnings::concentric_wall());
            }
            walls
        }
    };
    // A knoll in or at the rim of the town carries its castle, in its own
    // contour circuit; the town wall runs round it where it stands astride.
    let occupied: Vec<Shape> = plan.quarters.iter().map(|q| q.shape.clone()).collect();
    let castle = fortification::heights_castle(&walls, &occupied, &plan.streets, surface, cfg, culture, site.population, &base);
    let walls = match &castle { Some(c) => fortification::wrap_castle(walls, c), None => walls };
    // Underdark: the chamber's rock is the enceinte; one circuit closes the passages into it (barrier
    // walls between the rock faces). A surface town keeps its circuits unchanged.
    let (walls, cave) = fortification::cave_circuits(walls, surface);
    laps.lap("extension+castle");
    style.options(cfg);
    style.cave = cave;
    // The land gates of the town circuits are decided here, on the armature, while nothing stands
    // on the trace: the budget keeps the passages, their streets turn square to the curtain, the
    // other crossings close. The quarters are then cut along curtains whose gates are final. A
    // planned rectangle, a bastioned front, a cave barrier and a stretch shared by two circuits
    // keep their line.
    let moat = style.ditch_width[1];
    let gated = |purpose: &'static str, curtain_width: f64, squared: bool, streets_turn: bool| fortification::Circuit {
        pop: site.population, purpose, kind, curtain_width, moat, grade: cfg.max_street_grade, squared, streets_turn, key: &site.key,
        improvisation: cfg.street_improvisation,
    };
    let squared = !(square || attached || cave || style.id == "bastioned");
    let mut passages = vec![];
    let mut decided = Vec::with_capacity(walls.len());
    for wall in &walls {
        let (wall, kept, shut) = fortification::decide_gates(wall, &mut plan.streets, &gated("", style.curtain_width, squared, !(attached || cave)), surface);
        passages.push((kept, shut));
        decided.push(wall);
    }
    let walls = decided;
    laps.lap("gates");
    let mut inner_style = style.inner(culture, site.population);
    inner_style.options(cfg);
    let data = culture_data(culture, site.population);
    let fossil = data["core"]["enclosure"]["fossil"]
        .as_str()
        .unwrap_or("none");
    let mut inner_walls = vec![];
    // A metropolis keeps every older circuit: each became a ring boulevard
    // when the next wall was built (unless the culture keeps inner walls).
    let citadel = cfg.old_enclosure_citadel && fortification::keeps_citadel(culture);
    let fossil = if citadel { "wall" } else if metropolis && fossil != "wall" {
        "street"
    } else {
        fossil
    };
    // A large planned capital draws one circuit per epoch (palace/inner/outer city, see `retained`).
    let circuits = if metropolis || planned && site.population >= 100_000 { walled } else { walled.min(2) };
    // The circuit the extension attaches to is one of the two walls, not a fossil.
    let circuits = if attached { circuits.min(walled - 1) } else { circuits };
    for count in 1..circuits {
        let old = enclosed(count, "").unwrap_or_default();
        if fossil == "street" {
            // The first circuit, demolished, leaves a ring boulevard on its line.
            // Where the old line crosses water or a steep bank the boulevard
            // stops; its dry runs remain.
            let rings: Vec<_> = old
                .iter()
                .flat_map(|s| dry_runs(&closed(&s.outer), surface, cfg.max_street_grade))
                .collect();
            if !rings.is_empty() {
                partition(&mut plan.quarters, &old);
                let mut rng = Rng::new(&site.key).fork(&if count == 1 {
                    "fossil-ring".to_string()
                } else {
                    format!("fossil-ring:{count}")
                });
                for path in rings {
                    plan.streets.push(Street {
                        widths: vec![morph.width(1, &mut rng); path.len()],
                        path,
                        rank: 1,
                        role: "ring".into(),
                    });
                }
            }
        } else if fossil == "wall" {
            let old = if inner_style.hill {
                enclosed(count, "hill").unwrap_or(old)
            } else if square {
                enclosed(count, "square").unwrap_or(old)
            } else {
                old
            };
            let old = fortification::trace_enclosures(old, &plan.quarters.iter()
                .map(|q| q.shape.clone()).collect::<Vec<_>>(), surface);
            partition(&mut plan.quarters, &old);
            // An older circuit parted by a wide water stood on its main bank only.
            inner_walls.extend(old.into_iter().filter_map(|s| {
                let trace = fortification::parameter_trace(s, surface, cfg, culture, inner_style.curtain_width);
                dry(vec![trace], inner_style.curtain_width).into_iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
            }));
        }
    }
    // An older circuit lies inside the newer one, clear of its curtain: it is
    // clipped to it, and dropped when under half of it would remain.
    if !walls.is_empty() && !inner_walls.is_empty() {
        use geo::Buffer;
        let margin = style.curtain_width + 6.0;
        let room: Vec<Shape> = walls.iter().flat_map(|w| std::panic::catch_unwind(std::panic::AssertUnwindSafe(||
            g::shapes(g::polygon(w).buffer(-margin)))).unwrap_or_default()).collect();
        inner_walls = inner_walls.into_iter().filter_map(|s| {
            let area = g::area(&s);
            room.iter().flat_map(|r| g::intersection(&s, r)).max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
                .filter(|k| g::area(k) >= 0.5 * area)
                .map(|k| if g::area(&k) >= area - 1.0 { s } else { k })
        }).collect();
        if !citadel {
            inner_walls = fortification::retained(inner_walls, &walls);
        }
    }
    // The port yards outside the walls belong to the youngest epoch.
    if let Some(last) = phases.last_mut() {
        last.shapes.extend(yards);
    }
    // A town's enceinte, square or polygonal, is filled to its wall street (the
    // castle keeps its own ward); a small settlement fills a square circuit and
    // fits its quarters to any other.
    if cave {
        // A cave circuit closes passages: the quarters keep their own outline inside the chamber.
    } else if small {
        let (rect, other): (Vec<Shape>, Vec<Shape>) = walls.iter().cloned().partition(|w| square && rectangular(w));
        fit_enclosed_quarters(&mut plan.quarters, &other, &plan.streets, surface);
        fill_enclosures(&mut plan.quarters, phases, &rect, walled, &plan.streets, surface);
    } else {
        let land: Vec<Shape> = match &castle {
            Some(c) => walls.iter().flat_map(|w| g::difference(w, c)).collect(),
            None => walls.clone(),
        };
        fill_enclosures(&mut plan.quarters, phases, &land, walled, &plan.streets, surface);
    }
    partition(&mut plan.quarters, &walls);
    if let Some(c) = &castle {
        partition(&mut plan.quarters, std::slice::from_ref(c));
    }
    laps.lap("inner+fill");
    let first = plan.enclosures.len();
    let outer = walls.len();
    // Gate passages and causeways are cut at the width the street hierarchy
    // gives these streets later (through routes become arterial gate streets).
    let rank_base: [f64; 5] = std::array::from_fn(|r| {
        morph.value["widthByRank"][r].as_f64().unwrap_or(3.0) * morph.number_or("widthScale", 1.0)
    });
    let table = super::super::network::rank_widths(rank_base, site.population, cfg.road_width_by_size);
    let predicted = fortification::Predicted {
        widths: table.map(|w| w * 1.1),
        arterial: if site.population >= 20_000 { 0 } else { 1 },
        dwelling: super::super::culture::mapping_for(culture, &cfg.programme.period).map_or([5.0, 5.0], |m| {
            [m.admissibility.min_frontage, m.admissibility.min_depth]
        }),
    };
    let castle_at = walls.len() + inner_walls.len();
    for (i, wall) in walls.iter().chain(&inner_walls).chain(castle.iter()).enumerate() {
        // An older circuit and the castle open their gates by the same budget, on their trace as it is.
        let purpose = if i >= castle_at { "castle" } else if citadel && i >= outer { "citadel" } else { "" };
        let (kept, shut) = if i < outer { std::mem::take(&mut passages[i]) } else {
            let width = if i >= castle_at { style.curtain_width } else { inner_style.curtain_width };
            let (_, kept, shut) = fortification::decide_gates(wall, &mut plan.streets, &gated(purpose, width, false, false), surface);
            (kept, shut)
        };
        let path = closed(&wall.outer);
        let gates = gates(&path, &plan.streets);
        let land = gates.len();
        // Where the curtain crosses a channel it opens on a water gate (`fortification::build`).
        let banks = water_gates(&path, surface);
        let mut enclosure = Enclosure {
            path,
            kind: kind.into(),
            purpose: purpose.into(),
            gates,
            ..Default::default()
        };
        // Towers, gatehouses, bastions, outworks, ditch and lean-tos, clipped
        // by the same rules; an older inner circuit is one step plainer. The
        // lanes serving the faubourg lean-tos join the plan streets.
        let lanes = fortification::build(
            &mut enclosure,
            land,
            &banks,
            &plan.streets,
            surface,
            if i < outer || i >= castle_at { &style } else { &inner_style },
            site.population,
            &predicted,
            &base.fork(&format!("enc:{i}")),
        );
        plan.streets.extend(lanes);
        // A main road the budget shut out goes round outside the moat to a kept gate.
        fortification::divert(&enclosure, &kept, &shut, &mut plan.streets, surface, cfg.max_street_grade);
        plan.enclosures.push(enclosure);
    }
    laps.lap("build");
    // The two attached circuits keep no ditch or outwork inside each other.
    if attached && outer >= 2 {
        let (a, b) = (closed_shape(&plan.enclosures[first]), closed_shape(&plan.enclosures[first + 1]));
        fortification::trim_shared(&mut plan.enclosures[first], &b);
        fortification::trim_shared(&mut plan.enclosures[first + 1], &a);
        fortification::dedupe_shared(&mut plan.enclosures[first + 1], &a);
        fortification::inner_gates(&mut plan.enclosures[first], &b);
    }
    // No quarter keeps land in a tower, a ditch or a glacis.
    fortification::yield_reserve(&mut plan.quarters, &plan.enclosures[first..]);
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  fortification[{}]: relief {relief:.3}, wet {wet_share:.2}, {:.0} ms",
            style.id,
            tick.elapsed().as_secs_f64() * 1000.0
        );
    }
    for phase in phases.iter_mut().skip(walled) {
        phase.kind = "faubourg".into();
        if cfg.recipe == "auto" {
            phase.recipe = recipe(culture, site.population, "faubourg");
        }
    }
    faubourgs::grow_gate_villages(plan, cfg, surface)
}
