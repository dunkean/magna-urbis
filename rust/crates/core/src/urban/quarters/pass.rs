//! The ordered quarter pass from the initial plan to a layout of blocks and streets.

use super::blocks::{carve_blocks, repair_unserved_blocks};
use super::capacity::borrowed_quarters;
use super::cut::cut_quarters;
use super::frontage::extend_frontage;
use super::initial_plan::{InitialPlan, initial_plan};
use super::service::serve_quarters;
use super::squares::squares;
use super::street_finish::{finish_connections, finish_streets};
use super::vacancy::leave_fringe_fields;
use crate::rng::Rng;
use crate::urban::{
    Layout, LayoutConfig, Morph, Point, Shape, Site, Street, Surface, edits, footprint::capacity,
    generation_limits, geometry as g, influences, macroplan, network, profiles, warnings,
};

pub(super) fn generate_once(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Layout, String> {
    // Stairs are a cultural answer to slopes (hill towns, terraces), not a
    // universal repair: elsewhere every street and quarter keeps street grade.
    let applied = cfg;
    let effective = LayoutConfig {
        allow_stairs: profiles::stairs_allowed(
            cfg,
            if cfg.culture == "site" {
                &site.culture
            } else {
                &cfg.culture
            },
        ),
        ..cfg.clone()
    };
    let cfg = &effective;
    let rng = Rng::new(seed).fork(&format!("urban-layout:{}", site.key));
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    #[cfg(target_arch = "wasm32")]
    let lap = |_: &str| {};
    #[cfg(not(target_arch = "wasm32"))]
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!("  {label}: {:.0} ms", tick.elapsed().as_secs_f64() * 1000.0);
        }
    };
    let center = site.center;
    let InitialPlan {
        mut quarters,
        mut streets,
        enclosures,
        mut warnings,
        mut phases,
        mut structure,
        nucleus_radius,
        archetype,
        radius,
        angle,
    } = initial_plan(seed, site, cfg, m, surface, roads, &rng)?;
    lap("composition.plan");
    if cfg.placement == "center"
        && let Some(w) = serve_quarters(
            &mut quarters,
            &mut streets,
            &enclosures,
            &mut phases,
            structure.as_mut(),
            cfg,
            m,
            surface,
            roads,
            &mut rng.fork("quarter-service"),
        )
    {
        warnings.push(w);
    }
    lap("composition");
    // Apply user-supplied quarter outlines before tracing their streets.
    edits::reshape_quarters(
        &mut quarters,
        &mut phases,
        &streets,
        &enclosures,
        cfg,
        surface,
        center,
        radius,
        &mut warnings,
    );
    // A modern enceinte holds the founding epochs only: the younger growth
    // outside keeps the open-fringe treatment (exits, peripheral frontage).
    let walled: Vec<Shape> = enclosures
        .iter()
        .map(|e| {
            let mut outer = e.path.clone();
            if outer.len() > 3 && outer.first() == outer.last() {
                outer.pop();
            }
            g::normalized(Shape {
                outer,
                holes: vec![],
            })
        })
        .collect();
    let land: f64 = quarters.iter().map(|q| g::area(&q.shape)).sum();
    let open_edge = enclosures.is_empty()
        || cfg.footprint.mechanism != "legacy"
            && g::union(&walled).iter().map(g::area).sum::<f64>() < 0.95 * land;
    influences::apply(&mut phases, &mut quarters, site, cfg);
    influences::zone_overrides(&mut phases, site, cfg);
    if !cfg.mix_culture.is_empty()
        && let Some(s) = &mut structure
    {
        for d in &mut s.districts {
            if let Some(q) = d.quarters.first().and_then(|&i| quarters.get(i)) {
                d.phase = q.phase;
            }
        }
    }
    if quarters.is_empty() {
        return Ok(Layout {
            config: Some(applied.clone()),
            programme: None,
            key: site.key.clone(),
            culture: if cfg.culture == "site" {
                site.culture.clone()
            } else {
                cfg.culture.clone()
            },
            center,
            quarters,
            streets: vec![],
            blocks: vec![],
            warnings: std::iter::once(warnings::no_buildable_quarters())
                .chain(warnings)
                .chain(generation_limits::population_warning(0, site.population))
                .collect(),
            enclosures,
            phases,
            archetype,
            structure,
            claim: Default::default(),
        });
    }
    // Adaptive capacity (`footprint::capacity`): the plan sized with the
    // footprint, and the quarters cut with a borrowed compact tissue.
    let mut plan = structure.as_ref().and_then(|s| s.metrics.capacity.clone());
    if let Some(p) = plan.as_mut()
        && !p.donor.is_empty()
        && p.borrowed_share > 0.0
    {
        p.borrowed_quarters = borrowed_quarters(&quarters, center, p.borrowed_share, cfg);
    }
    let capacity_morph = |morph: Morph, quarter: Option<usize>, recipe: &str, zone: &str| {
        capacity::adapt(
            morph,
            plan.as_ref(),
            quarter,
            recipe,
            zone,
            site.population,
            cfg.density,
            "quarters",
        )
    };
    let adapted = capacity_morph(m.clone(), None, "core", "core");
    let m = &adapted;
    let (mut pieces, edited_phases) = cut_quarters(
        &quarters, &mut streets, &enclosures, &phases, structure.as_ref(), &walled,
        plan.as_ref(), capacity_morph, site, cfg, m, surface, roads, radius, nucleus_radius,
        angle, &rng, &lap,
    )?;
    let path_camp = finish_streets(
        &mut streets, &quarters, &enclosures, structure.as_ref(), &mut warnings,
        open_edge, site, cfg, m, surface, roads, radius, nucleus_radius, &rng, &lap,
    );
    extend_frontage(
        &mut quarters, &mut streets, &mut pieces, &enclosures, &mut phases, &mut structure,
        open_edge, site, cfg, applied, m, surface, &rng, &lap,
    );
    finish_connections(&mut streets, &enclosures, site, surface, cfg, m, path_camp, &lap);
    let (mut blocks, vacancies) = carve_blocks(
        pieces, &quarters, &streets, &enclosures, &phases, &walled, cfg, surface,
        center, radius, nucleus_radius, site.population, &lap,
    );
    let predicted = leave_fringe_fields(
        seed, site, cfg, applied, surface, &quarters, &mut streets, &mut blocks, &phases,
        &enclosures, &archetype, structure.as_ref(), &mut plan, &vacancies, &mut warnings,
        &rng, &lap,
    );
    repair_unserved_blocks(&mut blocks, &streets, &mut warnings);
    // An edited quarter culture travels to its lots through a phase of its own
    // (appended, so earlier phase indices never move).
    for (qi, phase) in edited_phases {
        let index = phases.len();
        phases.push(phase);
        for b in blocks.iter_mut().filter(|b| b.quarter == qi) {
            b.phase = Some(index);
        }
    }
    lap("overrides");
    if cfg.placement == "center" {
        let mut hubs: Vec<(Point, f64)> = structure.as_ref().map_or_else(Vec::new, |s| {
            s.centers.iter().map(|c| (c.point, c.weight)).collect()
        });
        hubs.sort_by(|a, b| b.1.total_cmp(&a.1));
        if hubs.is_empty() {
            hubs.push((center, 1.0));
        }
        let gates: Vec<Point> = enclosures.iter().flat_map(|e| e.gates.clone()).collect();
        squares(
            &mut blocks,
            &streets,
            &hubs,
            &gates,
            site.population,
            m,
            &mut rng.fork("squares"),
        );
    }
    lap("squares");
    if cfg.monument != "none"
        // A monument precinct must not consume the settlement's only residential
        // block. Camps keep their whole ring/row plan in that one block.
        && blocks.iter().filter(|b| b.kind == "block").count() > 1
        && let Some(b) = blocks
            .iter_mut()
            .filter(|b| b.kind == "block")
            .max_by(|a, b| g::area(&a.shape).total_cmp(&g::area(&b.shape)))
    {
        b.kind = format!("compound:{}", cfg.monument)
    }
    // Piers, landing stages and moles stand on the finished quays, over the
    // water: they cut no block.
    // Keep crossing demand until final harbour clearance can relocate it inland.
    if macroplan::harbour::port_town(cfg)
        && !(cfg.harbour_bridge_clearance && streets.iter().any(|s| s.role == "quay")) {
        macroplan::harbour::keep_sea_access(&mut streets,surface,roads);
    }
    let works = macroplan::harbour::typed_works(
        seed,
        &streets,
        surface,
        site,
        if cfg.culture == "site" {
            &site.culture
        } else {
            &cfg.culture
        },
        cfg,
    );
    streets.extend(works);
    lap("harbour_works");
    network::join_waterfront(&mut streets, radius);
    lap("join_waterfront");
    let mut layout = Layout {
        config: Some(applied.clone()),
        programme: None,
        key: site.key.clone(),
        culture: if cfg.culture == "site" {
            site.culture.clone()
        } else {
            cfg.culture.clone()
        },
        center,
        quarters,
        streets,
        blocks,
        warnings,
        enclosures,
        phases,
        archetype,
        structure,
        claim: Default::default(),
    };
    if let Some(mut p) = plan {
        let culture = layout.culture.clone();
        p.predicted = predicted * (1.0 - capacity::BLOCK_LOSS);
        p.shortfall = (p.required - p.predicted).max(0.0);
        let steps = capacity::describe(&culture, &p);
        let short = p.shortfall > 0.05 * p.required;
        if !steps.is_empty() || short {
            let housed = (p.predicted / p.required.max(1.0)).min(1.0);
            layout.warnings.push(warnings::planned_capacity((housed * 100.0).round(), &steps, short));
        }
        if let Some(s) = layout.structure.as_mut() {
            s.metrics.capacity = Some(p);
        }
    }
    Ok(layout)
}
