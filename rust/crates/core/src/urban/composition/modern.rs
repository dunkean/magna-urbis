//! Growth phases and secondary centres along the modern composition path.

use super::*;

/// Compose inherited land first, then share the armature across its chronological
/// sectors. Epoch boundaries partition ownership, not independent street engines.
pub(super) fn generate_modern(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
) -> Result<Composition, String> {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let small = crate::settlements::demographics::below(site.population, "town");
    let initial_recipe = recipe(
        culture,
        site.population,
        if small { "village" } else { "core" },
    );
    let initial_zone = if cfg.zone != "auto" {
        cfg.zone.as_str()
    } else if small && footprint::enclosed(cfg, culture, site.population) {
        "core"
    } else if small {
        "village"
    } else {
        "core"
    };
    let morph = super::super::with_tissue(
        phase_morph(
            culture,
            &initial_recipe,
            initial_zone,
            &cfg.preset,
            &cfg.recipe,
            cfg.density,
            &cfg.params,
            "quarters",
        )?,
        &cfg.tissue,
    );
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    let mut footprint = footprint::generate(seed, site, cfg, &morph, surface, roads, radius);
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  footprint: {:.0} ms",
            tick.elapsed().as_secs_f64() * 1000.0
        );
    }
    // A port town keeps the land of its centre: an outline that spans a bay clips to its islets too,
    // which no street reaches.
    if macroplan::harbour::port_town(cfg) && !macroplan::harbour::params(culture).fondamenta && surface.n > 1 {
        let reach = macroplan::harbour::Reach::new(surface, site.center, roads);
        let reached = |s: &Shape| reach.holds(g::interior_point(s));
        if footprint.structure.allocated.iter().any(reached) {
            footprint.structure.allocated.retain(reached);
            for shapes in &mut footprint.phases {
                shapes.retain(reached);
            }
        }
    }
    let kind = Kind::from_id(&cfg.settlement_form);
    if kind == Some(Kind::Metropolis) {
        wards(&mut footprint.structure, site, roads);
    }
    let growth_roads = [
        roads,
        footprint.guides.as_slice(),
        footprint.links.as_slice(),
    ]
    .concat();
    // A port reaches its waterline: the harbour apron joins the land the
    // growth grid left between town and water.
    if macroplan::harbour::port_town(cfg) {
        for domain in &mut footprint.structure.allocated {
            let wide = macroplan::harbour::apron(domain, surface, cfg, 50.0);
            // The apron belongs to the epoch it adjoins (walls, zones and
            // densities read the epoch shapes).
            for piece in g::difference(&wide, domain) {
                let c = g::interior_point(&piece);
                let near = |s: &Shape| {
                    s.outer
                        .iter()
                        .map(|p| (p.x - c.x).hypot(p.y - c.y))
                        .fold(f64::INFINITY, f64::min)
                };
                if let Some(epoch) = (0..footprint.phases.len())
                    .filter(|&e| !footprint.phases[e].is_empty())
                    .min_by(|&a, &b| {
                        let d = |e: usize| {
                            footprint.phases[e]
                                .iter()
                                .map(near)
                                .fold(f64::INFINITY, f64::min)
                        };
                        d(a).total_cmp(&d(b))
                    })
                {
                    let mut shapes = std::mem::take(&mut footprint.phases[epoch]);
                    shapes.push(piece);
                    // Pockets closed between the apron and the stair-stepped
                    // epoch edge are part of the epoch.
                    footprint.phases[epoch] = g::union(&shapes)
                        .into_iter()
                        .map(|mut s| {
                            s.holes.retain(|h| g::signed(h).abs() >= 2500.0);
                            s
                        })
                        .collect();
                }
            }
            *domain = wide;
        }
    }
    let domains = footprint.structure.allocated.clone();
    let total_area = domains.iter().map(g::area).sum::<f64>().max(1.0);
    let bounds = footprint
        .structure
        .reserve
        .iter()
        .chain(domains.iter())
        .map(g::bbox)
        .fold(
            (
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ),
            |(x0, y0, x1, y1), (a, b, c, d)| (x0.min(a), y0.min(b), x1.max(c), y1.max(d)),
        );
    let envelope = if bounds.0.is_finite() {
        g::rectangle(bounds.0, bounds.1, bounds.2, bounds.3)
    } else {
        g::rectangle(
            site.center.x - 1.0,
            site.center.y - 1.0,
            site.center.x + 1.0,
            site.center.y + 1.0,
        )
    };
    let mut plan = macroplan::Plan {
        envelope,
        structure: None,
        quarters: vec![],
        streets: vec![],
        enclosures: vec![],
        warnings: vec![],
    };
    // The components are planned independently (each from its own seeded
    // stream), in parallel, and merged in component order.
    let grid_angle = cfg.regular_grid_outline.then(|| footprint::orientation(site, cfg, surface, roads));
    let centers = &footprint.structure.centers;
    let parts = super::super::par::map(&domains, |component, domain| {
        if g::area(domain) < 25.0 {
            return None;
        }
        let center = centers
            .iter()
            .filter(|c| g::contains(domain, c.point))
            .max_by(|a, b| a.weight.total_cmp(&b.weight))
            .map(|c| c.point)
            .unwrap_or_else(|| g::interior_point(domain));
        let local = Site {
            key: site.key.clone(),
            name: site.name.clone(),
            population: (site.population as f64 * g::area(domain) / total_area)
                .round()
                .max(1.0) as u32,
            culture: site.culture.clone(),
            center,
            radius: (g::area(domain) / std::f64::consts::PI).sqrt(),
            neighbours: site.neighbours.clone(),
        };
        let mut local_cfg = cfg.clone();
        // The macro armature grows with the land: about one quarter per 20 ha,
        // never fewer than the requested share. A metropolis is not 4 sectors.
        local_cfg.count = ((cfg.count as f64 * g::area(domain) / total_area).ceil() as usize)
            .max((g::area(domain) / QUARTER_AREA).round() as usize)
            .clamp(1, 256);
        // A village is one or two quarters around its green, not four sectors.
        if kind == Some(Kind::NucleatedVillage) {
            local_cfg.count = ((g::area(domain) / 40_000.0).round() as usize).clamp(1, 3);
        }
        local_cfg.rings = 1;
        Some(macroplan::generate_oriented_domain(
            &format!("{seed}\u{1}component:{component}"),
            &local,
            &local_cfg,
            &morph,
            surface,
            &growth_roads,
            local.radius,
            Some(domain),
            grid_angle,
        ))
    });
    for mut part in parts.into_iter().flatten() {
        plan.quarters.append(&mut part.quarters);
        plan.streets.append(&mut part.streets);
        // Each component's full outline is not a wall; `fortify` draws the
        // enceinte around the founding epochs instead.
        plan.warnings.append(&mut part.warnings);
    }
    // Keep the access through unoccupied gaps, not just its clips inside each
    // neighbourhood. These paths do not enlarge attributed land.
    plan.streets.append(&mut footprint.links);
    // Crossing spans belong to the regional network. Preserve their complete
    // connection between allocated components, including the intervening water.
    for road in roads
        .iter()
        .filter(|s| matches!(s.role.as_str(), "bridge" | "ford" | "causeway"))
    {
        if domains
            .iter()
            .filter(|d| !macroplan::clip(road, d).is_empty())
            .count()
            >= 2
        {
            plan.streets.extend(macroplan::clip(road, &plan.envelope));
        }
    }
    let mut phases = vec![];
    // Population follows land times the epoch's own density: the dense old core
    // houses more people per hectare than the younger periphery.
    let densities = footprint::epoch_densities(site, cfg, &morph);
    let density_at = |epoch: usize| densities[epoch.min(densities.len() - 1)];
    let housed: f64 = footprint
        .phases
        .iter()
        .enumerate()
        .map(|(epoch, shapes)| shapes.iter().map(g::area).sum::<f64>() * density_at(epoch))
        .sum::<f64>()
        .max(1e-9);
    for (epoch, shapes) in footprint.phases.iter().enumerate() {
        // Zone and recipe name as the footprint sized them (a suburb ring
        // takes the faubourg tissue).
        let (zone, name) = footprint::epoch_zone(cfg, culture, site.population, epoch);
        let zone = zone.to_owned();
        let recipe = if cfg.recipe != "auto" {
            cfg.recipe.clone()
        } else {
            recipe(culture, site.population, name)
        };
        let phase_area = shapes.iter().map(g::area).sum::<f64>();
        phases.push(GrowthPhase {
            culture: culture.into(),
            kind: footprint.structure.history[epoch].kind.clone(),
            zone,
            recipe,
            population: site.population as f64 * phase_area * density_at(epoch) / housed,
            target_area: footprint.structure.metrics.target_area * phase_area / total_area,
            shapes: shapes.clone(),
        });
    }
    let (gate_centers, gate_lanes) = fortify(
        &mut plan,
        &mut phases,
        culture,
        site,
        cfg,
        surface,
        roads,
        &morph,
        small,
        kind == Some(Kind::Metropolis),
    );
    if kind == Some(Kind::Metropolis) {
        absorbed_villages(
            &mut phases,
            footprint.structure.centers.as_slice(),
            &mut footprint.structure.history,
            culture,
        );
    }
    // Calculation sectors follow the shared armature, not the age bands. Cutting
    // a sector at an ownership/epoch boundary would stop each tissue's tracing
    // there and create false dead ends. Retain exact history domains separately;
    // each undivided sector receives its dominant historical identity.
    for quarter in &mut plan.quarters {
        let epoch = phases
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let overlap: f64 = p
                    .shapes
                    .iter()
                    .flat_map(|s| g::intersection(&quarter.shape, s))
                    .map(|s| g::area(&s))
                    .sum();
                (i, overlap)
            })
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
            .map(|v| v.0)
            .unwrap_or(0);
        quarter.phase = epoch;
        // A plan without growth phases (seen with `pnw-plank-village` on a 20 km region) keeps the quarter's own zone.
        if let Some(phase) = phases.get(epoch) {
            quarter.zone = phase.zone.clone();
        }
    }
    plan.warnings.append(&mut footprint.warnings);
    footprint.structure.metrics.components = domains.len();
    let archetype = footprint.structure.family.clone();
    footprint.structure.gate_village_centers = gate_centers;
    footprint.structure.gate_village_lanes = gate_lanes;
    plan.structure = Some(footprint.structure);
    Ok(Composition {
        plan,
        phases,
        archetype,
        nucleus_radius: footprint.radius,
    })
}

/// Metropolis wards: secondary centres on the main radials, where the towns
/// and villages the city absorbed stood, then evenly by bearing. The main
/// centre keeps most of the weight; quarters route to their nearest centre and
/// districts lean on it. Recorded as `ward` events after the growth history.
fn wards(s: &mut super::super::UrbanStructure, site: &Site, roads: &[Street]) {
    let Some(main) = s
        .centers
        .iter()
        .max_by(|a, b| a.weight.total_cmp(&b.weight))
        .map(|c| (c.point, c.weight))
    else {
        return;
    };
    let area: f64 = s.allocated.iter().map(g::area).sum();
    let r = (area / std::f64::consts::PI).sqrt();
    let wanted = ((f64::from(site.population) / 75_000.0).round() as usize).clamp(3, 7);
    let dist = |a: Point, b: Point| (a.x - b.x).hypot(a.y - b.y);
    let inside = |p: Point| s.allocated.iter().any(|d| g::contains(d, p));
    let mut points: Vec<Point> = s.centers.iter().map(|c| c.point).collect();
    let mut added = vec![];
    let mut candidates = vec![];
    for road in roads
        .iter()
        .filter(|r| !matches!(r.role.as_str(), "bridge" | "ford" | "causeway"))
    {
        for w in road.path.windows(2) {
            let steps = (dist(w[0], w[1]) / 50.0).ceil().max(1.0) as usize;
            for k in 0..steps {
                let t = k as f64 / steps as f64;
                let p = Point {
                    x: w[0].x + (w[1].x - w[0].x) * t,
                    y: w[0].y + (w[1].y - w[0].y) * t,
                };
                let d = dist(p, main.0);
                if (0.42 * r..=0.72 * r).contains(&d) {
                    candidates.push(((d - 0.55 * r).abs(), p));
                }
            }
        }
    }
    candidates.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then(a.1.x.total_cmp(&b.1.x))
            .then(a.1.y.total_cmp(&b.1.y))
    });
    let bearings = (0..12).flat_map(|k| {
        let a = 0.3 + k as f64 * std::f64::consts::TAU / 12.0;
        [0.55, 0.45, 0.65].map(|f| {
            (
                0.0,
                Point {
                    x: main.0.x + f * r * a.cos(),
                    y: main.0.y + f * r * a.sin(),
                },
            )
        })
    });
    for (_, p) in candidates.into_iter().chain(bearings) {
        if points.len() >= wanted {
            break;
        }
        if inside(p) && points.iter().all(|&q| dist(p, q) > r * 0.35) {
            points.push(p);
            added.push(p);
        }
    }
    // Existing nuclei too small to hold a ward of their own are raised to the
    // ward weight, so quarters and districts lean on them.
    for c in &mut s.centers {
        if c.point != main.0 {
            c.weight = c.weight.max(main.1 * 0.2);
        }
    }
    for p in added {
        let id = s.centers.len();
        s.centers.push(UrbanCenter {
            id,
            point: p,
            weight: main.1 * 0.35,
        });
        s.history.push(UrbanEvent {
            epoch: 0,
            kind: "ward".into(),
            center: id,
            area: 0.0,
        });
    }
    let total: f64 = s.centers.iter().map(|c| c.weight).sum();
    for c in &mut s.centers {
        c.weight /= total.max(1e-9);
    }
}
/// The village each ward grew from survives as a phase of its own: village
/// tissue (organic lanes, a green) inside the later extensions. Land and
/// population move from the extension epochs; the founding core never absorbs.
fn absorbed_villages(
    phases: &mut Vec<GrowthPhase>,
    centers: &[UrbanCenter],
    history: &mut Vec<UrbanEvent>,
    culture: &str,
) {
    // Every secondary centre is a ward: those `wards` added and the growth
    // nuclei the footprint already had (separate early settlements).
    let main = centers
        .iter()
        .max_by(|a, b| a.weight.total_cmp(&b.weight))
        .map_or(usize::MAX, |c| c.id);
    let wards: Vec<usize> = centers
        .iter()
        .map(|c| c.id)
        .filter(|&id| id != main)
        .collect();
    let land: f64 = phases.iter().flat_map(|p| &p.shapes).map(g::area).sum();
    let radius = ((land / std::f64::consts::PI).sqrt() * 0.09).clamp(120.0, 260.0);
    for id in wards {
        let Some(c) = centers.get(id) else { continue };
        let disc = g::normalized(Shape {
            outer: (0..32)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / 32.0;
                    Point {
                        x: c.point.x + radius * a.cos(),
                        y: c.point.y + radius * a.sin(),
                    }
                })
                .collect(),
            holes: vec![],
        });
        let mut shapes = vec![];
        let mut population = 0.0;
        for phase in phases.iter_mut().skip(1) {
            let area: f64 = phase.shapes.iter().map(g::area).sum();
            let taken: Vec<Shape> = phase
                .shapes
                .iter()
                .flat_map(|s| g::intersection(s, &disc))
                .filter(|s| g::area(s) > 1.0)
                .collect();
            let moved: f64 = taken.iter().map(g::area).sum();
            if moved <= 0.0 || area <= 0.0 {
                continue;
            }
            let share = phase.population * moved / area;
            phase.population -= share;
            phase.target_area *= 1.0 - moved / area;
            population += share;
            phase.shapes = phase
                .shapes
                .iter()
                .flat_map(|s| g::difference(s, &disc))
                .filter(|s| g::area(s) > 1.0)
                .collect();
            shapes.extend(taken);
        }
        let area: f64 = shapes.iter().map(g::area).sum();
        if area < 10_000.0 {
            continue;
        }
        history.push(UrbanEvent {
            epoch: phases.len(),
            kind: "absorbed-village".into(),
            center: id,
            area,
        });
        phases.push(GrowthPhase {
            culture: culture.into(),
            kind: "absorbed-village".into(),
            zone: "village".into(),
            recipe: recipe(culture, 900, "village"),
            population,
            target_area: area,
            shapes,
        });
    }
}
