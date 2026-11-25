//! Assembly and dispatch for directly laid-out settlements.

use super::*;

/// Small kinds, laid out without the quarter grammar. `None` when the site
/// offers no dry land for them: the caller falls back to the quarter pipeline.
#[allow(clippy::too_many_arguments)]
pub(in crate::urban) fn lay_out(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    kind: Kind,
    morph: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
) -> Option<Layout> {
    // These camps already have the shared quarter + parcels/camp grammar.
    // Returning None delegates to the caller's existing quarter pipeline;
    // do not first replace its land with the legacy annular band below.
    if kind == Kind::Camp && (!morph.text("campLayout").is_empty()
        || organic_camp(culture(site, cfg), site.population, &morph.value))
        && native_camp(culture(site, cfg), site.population, cfg)
    {
        return None;
    }
    let culture = culture(site, cfg).to_owned();
    let mut rng = Rng::new(seed).fork(&format!("settlement-kind:{}", kind.id()));
    let reach = 600.0;
    let near = nearest(site.center, roads, reach);
    // Road ribbons the plots must not cover (all roads near the site).
    let obstacles: Vec<Shape> = roads
        .iter()
        .filter(|r| {
            r.path
                .windows(2)
                .any(|w| g::distance(site.center, w[0], w[1]).0 < 2500.0)
        })
        .flat_map(|r| g::ribbon(&r.path, &r.widths))
        .collect();
    // A road through a village or hamlet is its street: never narrower than
    // the place's through rank (`network::town_roads` widens it the same way).
    let table = super::super::network::town_table(morph, site.population, cfg.road_width_by_size);
    let through = if !cfg.town_main_road { 0.0 } else if kind == Kind::StreetVillage { table[1] } else { table[2] };
    let road_half = |n: &Near| {
        roads[n.road]
            .widths
            .iter()
            .copied()
            .fold(0.0_f64, f64::max)
            .max(3.0)
            .max(if matches!(kind, Kind::Hamlet | Kind::StreetVillage) { through } else { 0.0 })
            * 0.5
            + 0.05
    };
    let plan = match kind {
        Kind::Single | Kind::Ruin | Kind::Farmstead => homestead(
            site, cfg, kind, &near, &obstacles, &road_half, roads, surface, &mut rng,
        )?,
        Kind::Camp => camp(site, cfg, &near, &obstacles, surface, &mut rng)?,
        Kind::Hamlet => linear(site, cfg, kind, morph, &near, &obstacles, &road_half, roads, surface, &mut rng, 1.0)?,
        Kind::StreetVillage => {
            let need = wanted_homes(&culture, site.population);
            // Households first: a street village houses about the homes it
            // asks (95-110 %), counted on the real cut of its lots.
            let laid = |plan_cfg: &LayoutConfig| {
                street_village(seed, site, plan_cfg, cfg, morph, &near, &obstacles, &road_half, roads, surface, &culture, need)
            };
            let (layout, homes) = laid(cfg)?;
            // Invariant: the site-read plan (`villageStreets`) never houses fewer
            // households than the plain ribbon. Short of them, the ribbon lays
            // the village instead when it houses more (both cut as published).
            if cfg.village_streets && homes < need * 0.95 {
                let plain = LayoutConfig { village_streets: false, ..cfg.clone() };
                if let Some((mut ribbon, more)) = laid(&plain).filter(|(_, h)| *h > homes) {
                    ribbon.warnings.push(warnings::plain_village_ribbon(homes, need, more));
                    return Some(ribbon);
                }
            }
            return Some(layout);
        }
        _ => return None,
    };
    assemble(site, cfg, kind, morph, roads, &culture, plan)
}

/// Households a candidate layout houses, on the real cut of its lots (the
/// trim's probe: programme, then the parcels and their allocation), with the
/// published cut's seed (`seed` is the settlement's key seed): the same lots.
/// Also, per block of the layout, the households on it and whether only homes
/// (or open land) stand there: a block that may go back to the fields.
fn housed(seed: &str, layout: &Layout, cfg: &LayoutConfig, population: u32, surface: Surface<'_>) -> (f64, Vec<(f64, bool)>) {
    let seed = seed.rsplit_once("\u{1}settlement:").map_or(seed, |(raw, _)| raw);
    let mut probe = layout.clone();
    super::super::access::summarize(&mut probe, cfg);
    if super::super::programme::prepare(&mut probe, population, &cfg.programme, surface).is_err() {
        return (0.0, vec![]);
    }
    let Ok(part) = super::super::pipeline::probe_parcels(seed, &probe) else { return (0.0, vec![]) };
    let block_of: std::collections::HashMap<&str, usize> = part.parcels.iter().map(|p| (p.id.as_str(), p.block)).collect();
    let mut blocks = vec![(0.0, true); layout.blocks.len()];
    let mut total = 0.0;
    for a in part.programme.iter().flat_map(|p| &p.allocations) {
        total += a.households;
        if let Some(slot) = block_of.get(a.parcel_id.as_str()).and_then(|&b| blocks.get_mut(b)) {
            slot.0 += a.households;
            slot.1 &= (a.households > 0.0 && !a.landmark) || a.role.starts_with("open.");
        }
    }
    (total, blocks)
}

/// A street village with a surplus of homes gives its outermost plots back to
/// the fields (`reserve`, no new lay and no new cut): farthest from the centre
/// first, homes only (never a landmark or a service), never in the core (the
/// inner half of the string) and never a plot on a lane or track, so every lane
/// keeps the plots it serves. A plot is dropped only when the village keeps 97 %
/// of its households; it stops at 107 %. The households it then houses.
fn thin_ends(layout: &mut Layout, per_block: &[(f64, bool)], homes: f64, need: f64) -> f64 {
    let center = layout.structure.as_ref().and_then(|s| s.centers.first()).map_or(layout.center, |c| c.point);
    let lanes: Vec<&Street> = layout.streets.iter().filter(|s| matches!(s.role.as_str(), "lane" | "track" | "path")).collect();
    let on_lane = |shape: &Shape| {
        lanes.iter().any(|s| {
            let reach = s.widths.first().copied().unwrap_or(3.5) * 0.5 + 3.0;
            shape.outer.iter().any(|&v| s.path.windows(2).any(|w| g::distance(v, w[0], w[1]).0 < reach))
        })
    };
    let far = |i: usize| dist(g::centroid(&layout.blocks[i].shape), center);
    let plots: Vec<usize> = (0..layout.blocks.len()).filter(|&i| layout.blocks[i].kind == "block").collect();
    let reach = plots.iter().map(|&i| far(i)).fold(0.0, f64::max);
    let mut ends: Vec<usize> = plots
        .into_iter()
        .filter(|&i| per_block.get(i).is_some_and(|&(h, only_homes)| h > 0.0 && only_homes))
        .filter(|&i| far(i) > reach * 0.5 && !on_lane(&layout.blocks[i].shape))
        .collect();
    ends.sort_by(|&a, &b| far(b).total_cmp(&far(a)).then(a.cmp(&b)));
    let mut homes = homes;
    for i in ends {
        if homes <= need * 1.07 {
            break;
        }
        let h = per_block[i].0;
        if homes - h >= need * 0.97 {
            layout.blocks[i].kind = "reserve".into();
            homes -= h;
        }
    }
    homes
}

/// A street village sized to its households. The string is laid for `fill`
/// times them and sized on an estimate of the lots (`linear_homes`), up to
/// three lays; the real cut then measures it once and, off target, the
/// estimate is corrected by the measured ratio and the string sized again and
/// measured (two cuts at most); a surplus left then thins the string's ends
/// (`thin_ends`, no further cut). The plan is laid with `cfg`, the layout
/// carries `published` (what its parcels read). The layout and the households
/// it houses.
#[allow(clippy::too_many_arguments)]
fn street_village(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    published: &LayoutConfig,
    morph: &Morph,
    near: &Option<Near>,
    obstacles: &[Shape],
    road_half: &dyn Fn(&Near) -> f64,
    roads: &[Street],
    surface: Surface<'_>,
    culture: &str,
    need: f64,
) -> Option<(Layout, f64)> {
    let kind = Kind::StreetVillage;
    let stream = || Rng::new(seed).fork(&format!("settlement-kind:{}", kind.id()));
    let whole = cfg.village_streets
        && super::super::catalogue()["cultures"][culture]["village"]["street"]["wholeFarms"].as_bool() == Some(true);
    let estimate = |plan: &Plan| linear_homes(plan, morph, whole);
    // Distance to the target: within 95-110 % the nearest to 102 %; out of it a
    // shortfall always weighs more than a surplus.
    let miss = |h: f64, target: f64| {
        if h < target * 0.95 { 1e6 + target - h } else if h > target * 1.1 { 1e3 + h - target } else { (h - target * 1.02).abs() }
    };
    // The string whose estimate comes closest to `target`, from `fill`, on the same random stream.
    let fit = |target: f64, fill: f64| -> Option<(Plan, f64, f64)> {
        let mut fill = fill;
        let mut plan = linear(site, cfg, kind, morph, near, obstacles, road_half, roads, surface, &mut stream(), fill)?;
        let mut best = (estimate(&plan), fill);
        let mut last = best.0;
        for _ in 0..3 {
            if (target * 0.97..=target * 1.06).contains(&best.0) {
                break;
            }
            fill = (fill * target * 1.02 / last.max(1.0)).clamp(0.4, 4.0);
            let Some(next) = linear(site, cfg, kind, morph, near, obstacles, road_half, roads, surface, &mut stream(), fill) else {
                break;
            };
            last = estimate(&next);
            if miss(last, target) < miss(best.0, target) {
                (plan, best) = (next, (last, fill));
            }
        }
        Some((plan, best.0, best.1))
    };
    let build = |plan: Plan| {
        assemble(site, cfg, kind, morph, roads, culture, plan).map(|mut layout| {
            layout.config = Some(published.clone());
            let (homes, per_block) = housed(seed, &layout, published, site.population, surface);
            (layout, homes, per_block)
        })
    };
    let (plan, guess, fill) = fit(need, 1.0)?;
    let first = build(plan)?;
    let homes = first.1;
    // The cut houses `ratio` households per estimated lot: size the string for that.
    let mut best = first;
    if !(need * 0.97..=need * 1.07).contains(&homes) {
        let ratio = (homes / guess.max(1.0)).clamp(0.25, 4.0);
        if let Some(second) = fit(need / ratio, fill).and_then(|(plan, _, _)| build(plan))
            && miss(second.1, need) < miss(homes, need)
        {
            best = second;
        }
    }
    // A whole household is 4 % of a small village: a surplus left after the
    // two cuts goes back to the fields at the string's ends.
    let (mut layout, mut homes, per_block) = best;
    if homes > need * 1.07 {
        homes = thin_ends(&mut layout, &per_block, homes, need);
    }
    Some((layout, homes))
}

/// The small kind's `Layout` from its plan: its blocks as quarters of one
/// district, the regional roads near it as its streets.
fn assemble(site: &Site, cfg: &LayoutConfig, kind: Kind, morph: &Morph, roads: &[Street], culture: &str, plan: Plan) -> Option<Layout> {
    if plan.blocks.is_empty() {
        return None;
    }
    let culture = culture.to_owned();
    let table = super::super::network::town_table(morph, site.population, cfg.road_width_by_size);
    let through = if !cfg.town_main_road { 0.0 } else if kind == Kind::StreetVillage { table[1] } else { table[2] };
    // Regional roads crossing the place are part of its street network.
    let shapes: Vec<Shape> = plan.blocks.iter().map(|b| b.0.clone()).collect();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for s in &shapes {
        let b = g::bbox(s);
        (x0, y0, x1, y1) = (x0.min(b.0), y0.min(b.1), x1.max(b.2), y1.max(b.3));
    }
    let window = g::rectangle(x0 - 40.0, y0 - 40.0, x1 + 40.0, y1 + 40.0);
    let mut streets: Vec<Street> = roads
        .iter()
        .flat_map(|r| macroplan::clip(r, &window))
        .collect();
    streets.extend(plan.streets);
    if cfg.town_main_road && matches!(kind, Kind::Hamlet | Kind::StreetVillage) {
        super::super::network::town_roads(&mut streets, &shapes, through);
    }
    let area: f64 = shapes.iter().map(g::area).sum();
    let zone = "village".to_string();
    let recipe = if cfg.recipe != "auto" {
        cfg.recipe.clone()
    } else {
        composition::recipe(
            &culture,
            site.population,
            if kind == Kind::StreetVillage {
                "village"
            } else {
                "hamlet"
            },
        )
    };
    let quarters: Vec<Quarter> = shapes
        .iter()
        .map(|s| Quarter {
            shape: s.clone(),
            phase: 0,
            zone: zone.clone(),
        })
        .collect();
    let blocks: Vec<Block> = plan
        .blocks
        .iter()
        .enumerate()
        .map(|(i, (s, k))| Block {
            shape: s.clone(),
            quarter: i,
            kind: (*k).into(),
            axis: plan.axis,
            zone: zone.clone(),
            phase: Some(0),
        })
        .collect();
    let structure = UrbanStructure {
        quarter_baseline: None,
        shanty: None,
        spring_sites: vec![],
        gate_village_centers: vec![],
        gate_village_lanes: vec![],
        quays: vec![],
        waterways: vec![],
        port_districts: vec![],
        version: 1,
        mechanism: "kind".into(),
        family: kind.id().into(),
        reserve: vec![],
        allocated: g::union(&shapes),
        centers: vec![UrbanCenter {
            id: 0,
            point: plan.center,
            weight: 1.0,
        }],
        districts: vec![UrbanDistrict {
            id: 0,
            center: 0,
            phase: 0,
            tissue: kind.id().into(),
            quarters: (0..quarters.len()).collect(),
            role: String::new(),
            wealth: 0.0,
            label: String::new(),
        }],
        history: vec![UrbanEvent {
            epoch: 0,
            kind: kind.id().into(),
            center: 0,
            area,
        }],
        metrics: UrbanMetrics {
            target_area: area,
            allocated_area: area,
            gross_density: f64::from(site.population) * 10_000.0 / area.max(1.0),
            planned_population: f64::from(site.population),
            components: shapes.len(),
            ..UrbanMetrics::default()
        },
    };
    Some(Layout {
        config: Some(cfg.clone()),
        programme: None,
        key: site.key.clone(),
        culture: culture.clone(),
        center: site.center,
        quarters,
        streets,
        blocks,
        warnings: vec![],
        enclosures: vec![],
        phases: vec![GrowthPhase {
            culture,
            kind: kind.id().into(),
            zone,
            recipe,
            population: f64::from(site.population),
            target_area: area,
            shapes,
        }],
        archetype: kind.id().into(),
        structure: Some(structure),
        claim: Default::default(),
    })
}
