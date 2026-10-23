//! Settlement composition, before quarter and block subdivision. Cultural phase
//! thresholds, population shares and road ribbons follow the TypeScript planner.
use super::{
    Enclosure, GrowthPhase, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    UrbanCenter, UrbanEvent, catalogue, footprint, fortification, geometry as g, kinds::Kind,
    macroplan, profiles, resolve, routing,
};
use crate::rng::Rng;
use geo::algorithm::bool_ops::unary_union;

/// Target land of one macro quarter (m²), bounded by arterials or main streets.
pub(super) const QUARTER_AREA: f64 = 200_000.0;

pub(super) fn culture_data(culture: &str, population: u32) -> &'static serde_json::Value {
    let c = &catalogue()["cultures"][culture];
    if c["growth"]["minPop"]
        .as_u64()
        .is_some_and(|p| population as u64 >= p)
    {
        &c["growth"]
    } else {
        c
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn phase_morph(
    culture: &str,
    recipe: &str,
    zone: &str,
    preset: &str,
    selected: &str,
    density: f64,
    params: &serde_json::Value,
    stage: &str,
) -> Result<Morph, String> {
    resolve(
        culture,
        preset,
        if selected == "auto" { recipe } else { selected },
        zone,
        density,
        params,
        stage,
    )
}

pub(super) fn recipe(culture: &str, population: u32, name: &str) -> String {
    let c = &catalogue()["cultures"][culture];
    let grown = !std::ptr::eq(c, culture_data(culture, population));
    let grown_name = format!("grown-{name}");
    if grown && catalogue()["presets"][format!("{culture}/{grown_name}")].is_object() {
        grown_name
    } else if catalogue()["presets"][format!("{culture}/{name}")].is_object() {
        name.into()
    } else {
        "core".into()
    }
}

fn length(path: &[Point]) -> f64 {
    path.windows(2)
        .map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y))
        .sum()
}
fn cut_path(path: &[Point], limit: f64) -> Vec<Point> {
    let mut result = vec![path[0]];
    let mut remaining = limit;
    for w in path.windows(2) {
        let run = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
        if run < 1e-8 {
            continue;
        }
        let t = (remaining / run).min(1.0);
        result.push(Point {
            x: w[0].x + (w[1].x - w[0].x) * t,
            y: w[0].y + (w[1].y - w[0].y) * t,
        });
        remaining -= run;
        if remaining <= 0.0 {
            break;
        }
    }
    result
}
fn boundary_distance(shape: &Shape, p: Point) -> f64 {
    shape
        .outer
        .iter()
        .zip(shape.outer.iter().cycle().skip(1))
        .take(shape.outer.len())
        .map(|(&a, &b)| g::distance(p, a, b).0)
        .fold(f64::INFINITY, f64::min)
}
fn union(shapes: &[Shape]) -> Vec<Shape> {
    g::shapes(unary_union(
        &shapes.iter().map(g::polygon).collect::<Vec<_>>(),
    ))
}

fn outline(
    template: &Shape,
    center: Point,
    area: f64,
    enclosure: &serde_json::Value,
    rng: &mut Rng,
) -> Shape {
    let shape = enclosure["shape"].as_str().unwrap_or("organic");
    let angle = if enclosure["orientation"].as_str() == Some("cardinal") {
        0.0
    } else {
        (template.outer[0].y - center.y).atan2(template.outer[0].x - center.x)
    };
    let aspect = if matches!(shape, "circle" | "square") {
        1.0
    } else {
        rng.range(
            enclosure["aspect"][0].as_f64().unwrap_or(1.25),
            enclosure["aspect"][1].as_f64().unwrap_or(1.6),
        )
    };
    let at = |x: f64, y: f64| Point {
        x: center.x + x * angle.cos() - y * angle.sin(),
        y: center.y + x * angle.sin() + y * angle.cos(),
    };
    let outer = if matches!(shape, "rect" | "square" | "rounded-rect" | "terraces") {
        let hx = (area * aspect).sqrt() * 0.5;
        let hy = (area / aspect).sqrt() * 0.5;
        if shape == "rounded-rect" {
            let r = hy * 0.4;
            [
                (hx - r, hy - r, 0.0),
                (-hx + r, hy - r, std::f64::consts::FRAC_PI_2),
                (-hx + r, -hy + r, std::f64::consts::PI),
                (hx - r, -hy + r, std::f64::consts::PI * 1.5),
            ]
            .iter()
            .flat_map(|&(x, y, start)| {
                (0..=4).map(move |i| {
                    let a = start + i as f64 * std::f64::consts::FRAC_PI_2 / 4.0;
                    at(x + r * a.cos(), y + r * a.sin())
                })
            })
            .collect()
        } else {
            vec![at(-hx, -hy), at(hx, -hy), at(hx, hy), at(-hx, hy)]
        }
    } else if matches!(shape, "oval" | "circle") {
        let ry = (area / std::f64::consts::PI / aspect).sqrt();
        (0..64)
            .map(|i| {
                let a = i as f64 * std::f64::consts::TAU / 64.0;
                at(ry * aspect * a.cos(), ry * a.sin())
            })
            .collect()
    } else {
        let scale = (area / g::area(template)).sqrt();
        template
            .outer
            .iter()
            .map(|p| Point {
                x: center.x + (p.x - center.x) * scale,
                y: center.y + (p.y - center.y) * scale,
            })
            .collect()
    };
    g::normalized(Shape {
        outer,
        holes: vec![],
    })
}

/// Real outward continuations, clipped at the exact nucleus boundary. When the
/// regional network is absent, extend existing cultural axes with the same router.
fn approaches(
    plan: &macroplan::Plan,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    roads: &[Street],
    radius: f64,
) -> Vec<Street> {
    let (x0, y0, x1, y1) = g::bbox(&plan.envelope);
    let reach = radius * 3.0;
    let mut outside = g::rectangle(x0 - reach, y0 - reach, x1 + reach, y1 + reach);
    outside.holes.push(plan.envelope.outer.clone());
    let mut result = vec![];
    for road in roads {
        for mut part in macroplan::clip(road, &outside) {
            if boundary_distance(&plan.envelope, *part.path.last().unwrap()) < 0.1 {
                part.path.reverse();
                part.widths.reverse();
            }
            if boundary_distance(&plan.envelope, part.path[0]) > 0.1 {
                continue;
            }
            // Only a continuation attached to a retained, practicable axis grows.
            if !plan
                .streets
                .iter()
                .flat_map(|s| s.path.windows(2))
                .any(|w| g::distance(part.path[0], w[0], w[1]).0 < 0.1)
            {
                continue;
            }
            result.push(part);
        }
    }
    if !result.is_empty() {
        return result;
    }
    let mut planner = routing::RoutePlanner::new(surface, g::bbox(&outside));
    for street in plan
        .streets
        .iter()
        .filter(|s| s.rank <= 1 && !matches!(s.role.as_str(), "bridge" | "ford" | "causeway"))
    {
        for reverse in [false, true] {
            let path: Vec<_> = if reverse {
                street.path.iter().rev().copied().collect()
            } else {
                street.path.clone()
            };
            let end = *path.last().unwrap();
            if boundary_distance(&plan.envelope, end) > 0.1 || path.len() < 2 {
                continue;
            }
            if result
                .iter()
                .any(|s: &Street| (s.path[0].x - end.x).hypot(s.path[0].y - end.y) < 12.0)
            {
                continue;
            }
            let previous = path[path.len() - 2];
            let run = (end.x - previous.x).hypot(end.y - previous.y).max(0.01);
            let target = Point {
                x: (end.x + (end.x - previous.x) / run * radius * 1.7)
                    .clamp(0.01, surface.width - 0.01),
                y: (end.y + (end.y - previous.y) / run * radius * 1.7)
                    .clamp(0.01, surface.width - 0.01),
            };
            if let Some(path) = planner.route(end, target, cfg.max_street_grade) {
                if length(&path) < 20.0
                    || path.iter().skip(1).any(|&p| g::contains(&plan.envelope, p))
                {
                    continue;
                }
                result.push(Street {
                    widths: vec![street.widths.last().copied().unwrap_or(5.0); path.len()],
                    path,
                    rank: 1,
                    role: "approach".into(),
                });
            }
        }
    }
    result
}

pub(super) struct Composition {
    pub plan: macroplan::Plan,
    pub phases: Vec<GrowthPhase>,
    pub archetype: String,
    pub nucleus_radius: f64,
}

pub(super) fn generate(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
) -> Result<Composition, String> {
    if cfg.footprint.mechanism != "legacy" {
        return generate_modern(seed, site, cfg, surface, roads, radius);
    }
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let data = culture_data(culture, site.population);
    let rng = Rng::new(seed).fork("settlement-composition");
    let small = site.population < 1200;
    let rural = site.population < 200;
    let form = data[if rural { "hamlet" } else { "village" }]["form"]
        .as_str()
        .unwrap_or("auto");
    let near_roads = roads
        .iter()
        .filter(|s| {
            s.path
                .windows(2)
                .any(|w| g::distance(site.center, w[0], w[1]).0 < radius * 0.5)
        })
        .count();
    // A street village resolved by `kinds` that fell back to this grammar
    // (no dry land along its road) keeps its ribbon form.
    let ribbon = matches!(cfg.settlement_form.as_str(), "ribbon" | "street-village")
        || cfg.settlement_form == "auto"
            && small
            && form == "auto"
            && near_roads > 0
            && (rural
                || rng
                    .fork("archetype")
                    .chance(if near_roads <= 2 { 0.75 } else { 0.3 }));
    let archetype = if rural {
        "hamlet"
    } else if ribbon {
        "street-village"
    } else if small {
        "nucleated-village"
    } else {
        "town"
    };
    let count = if small {
        1
    } else if cfg.phases > 0 {
        cfg.phases
    } else if data["ring"].is_null() {
        1
    } else {
        data["phaseCount"]
            .as_array()
            .map(|a| {
                a.iter()
                    .rfind(|v| v[0].as_u64().unwrap_or(u64::MAX) <= site.population as u64)
                    .and_then(|v| v[1].as_u64())
                    .unwrap_or(1) as usize
            })
            .unwrap_or(1)
            .clamp(1, 5)
    };
    let mut shares: Vec<f64> = match count {
        1 => vec![1.0],
        2 => vec![0.42, 0.58],
        3 => vec![0.24, 0.36, 0.4],
        4 => vec![0.13, 0.22, 0.3, 0.35],
        _ => vec![0.1, 0.16, 0.22, 0.25, 0.27],
    };
    let fixed: Vec<_> = (0..count)
        .map(|i| {
            data[if i == 0 { "core" } else { "ring" }]["share"]
                .as_f64()
                .filter(|s| *s > 0.0)
        })
        .collect();
    let reserved: f64 = fixed.iter().flatten().sum();
    let free: f64 = shares
        .iter()
        .enumerate()
        .filter(|(i, _)| fixed[*i].is_none())
        .map(|(_, s)| s)
        .sum();
    for (i, s) in shares.iter_mut().enumerate() {
        *s = fixed[i].unwrap_or_else(|| {
            if free > 0.0 {
                *s / free * (1.0 - reserved).max(0.05)
            } else {
                0.0
            }
        });
    }
    let profile = profiles::settlement_profile(culture, site.population, count);
    let fortified = profiles::fortification(profile, &cfg.fortification, site.population) != "none";
    let share = if cfg.suburbs == "none" || ribbon || rural {
        0.0
    } else if small {
        0.3
    } else {
        data["faubShare"][usize::from(!fortified)]
            .as_f64()
            .unwrap_or(0.1)
    };
    let mut specs = vec![];
    for (i, &share) in shares.iter().enumerate() {
        let zone = if cfg.zone != "auto" {
            cfg.zone.as_str()
        } else if small {
            "village"
        } else if i == 0 {
            "core"
        } else if i == 1 {
            "middle"
        } else {
            "edge"
        };
        let name = if rural {
            "hamlet"
        } else if small {
            "village"
        } else if i == 0 {
            "core"
        } else {
            "ring"
        };
        let recipe = recipe(culture, site.population, name);
        let morph = phase_morph(
            culture,
            &recipe,
            zone,
            &cfg.preset,
            &cfg.recipe,
            cfg.density,
            &cfg.params,
            "quarters",
        )?;
        let jitter = morph.number("shareJitter");
        let share = share * (1.0 + rng.fork(&format!("shares:{i}")).range(-jitter, jitter));
        let weight = share
            / morph.value["density"][zone]
                .as_f64()
                .unwrap_or(60.0)
                .max(1.0);
        specs.push((zone.to_owned(), recipe, morph, share, weight));
    }
    let total_share: f64 = specs.iter().map(|s| s.3).sum();
    for spec in &mut specs {
        spec.3 /= total_share;
        spec.4 /= total_share;
    }
    let enc_weight: f64 = specs.iter().map(|v| v.4 * (1.0 - share)).sum();
    let faub_recipe = recipe(
        culture,
        site.population,
        if small { "village" } else { "faubourg" },
    );
    let faub_zone = if cfg.zone != "auto" {
        cfg.zone.as_str()
    } else if small {
        "village"
    } else {
        "faubourg"
    };
    let faub_morph = phase_morph(
        culture,
        &faub_recipe,
        faub_zone,
        &cfg.preset,
        &cfg.recipe,
        cfg.density,
        &cfg.params,
        "quarters",
    )?;
    let faub_weight = share
        / faub_morph.value["density"][faub_zone]
            .as_f64()
            .unwrap_or(35.0)
            .max(1.0)
        * if cfg.suburbs == "many" { 2.4 } else { 1.0 };
    let nucleus_radius = radius * (enc_weight / (enc_weight + faub_weight)).sqrt();
    let mut main_cfg = cfg.clone();
    main_cfg.rings = 1;
    main_cfg.phases = count;
    let mut plan = macroplan::generate(
        seed,
        site,
        &main_cfg,
        &specs[count - 1].2,
        surface,
        roads,
        nucleus_radius,
    );
    let target_area = g::area(&plan.envelope);
    if ribbon {
        let paths: Vec<_> = roads
            .iter()
            .flat_map(|s| macroplan::clip(s, &plan.envelope))
            .collect();
        let run: f64 = paths.iter().map(|s| length(&s.path)).sum();
        if run > 20.0 {
            let width = (target_area / run).min(radius * 0.7).max(20.0);
            let shapes = union(
                &paths
                    .iter()
                    .flat_map(|s| g::ribbon(&s.path, &[width]))
                    .collect::<Vec<_>>(),
            );
            plan.quarters = shapes
                .iter()
                .flat_map(|s| g::dry_clip(&surface, s))
                .map(|shape| Quarter {
                    shape,
                    phase: 0,
                    zone: specs[0].0.clone(),
                })
                .collect();
            plan.streets = paths;
            plan.enclosures.clear();
            let phase = GrowthPhase {
                culture: culture.into(),
                kind: if rural { "hamlet" } else { "village" }.into(),
                zone: specs[0].0.clone(),
                recipe: if cfg.recipe == "auto" {
                    specs[0].1.clone()
                } else {
                    cfg.recipe.clone()
                },
                population: site.population as f64,
                target_area,
                shapes: plan.quarters.iter().map(|q| q.shape.clone()).collect(),
            };
            return Ok(Composition {
                plan,
                phases: vec![phase],
                archetype: archetype.into(),
                nucleus_radius,
            });
        }
        plan.warnings
            .push("Aucune voie traversante : le village-rue utilise un noyau groupé.".into());
    }
    let mut phases = vec![];
    let mut cumulative = 0.0;
    let total_weight: f64 = specs.iter().map(|v| v.4).sum();
    let mut previous: Vec<Shape> = vec![];
    let mut quarters = vec![];
    for (i, (zone, recipe, _, pop_share, weight)) in specs.iter().enumerate() {
        cumulative += weight;
        let shape = if i + 1 == specs.len() {
            plan.envelope.clone()
        } else {
            outline(
                &plan.envelope,
                site.center,
                target_area * cumulative / total_weight,
                &data[if i == 0 { "core" } else { "ring" }]["enclosure"],
                &mut rng.fork(&format!("outline:{i}")),
            )
        };
        let region = union(&[previous.clone(), vec![shape]].concat())
            .iter()
            .flat_map(|s| g::intersection(s, &plan.envelope))
            .collect::<Vec<_>>();
        let mut band = region
            .iter()
            .flat_map(|s| g::dry_clip(&surface, s))
            .collect::<Vec<_>>();
        for prior in &previous {
            band = band.iter().flat_map(|s| g::difference(s, prior)).collect();
        }
        for q in &plan.quarters {
            quarters.extend(
                band.iter()
                    .flat_map(|s| g::intersection(&q.shape, s))
                    .filter(|s| g::area(s) > 1.0)
                    .map(|shape| Quarter {
                        shape,
                        phase: i,
                        zone: zone.clone(),
                    }),
            );
        }
        phases.push(GrowthPhase {
            culture: culture.into(),
            kind: if rural {
                "hamlet"
            } else if small {
                "village"
            } else if i == 0 {
                "core"
            } else {
                "ring"
            }
            .into(),
            zone: zone.clone(),
            recipe: recipe.clone(),
            population: site.population as f64 * (1.0 - share) * pop_share,
            target_area: target_area * weight / total_weight,
            shapes: band,
        });
        previous = region;
    }
    if share > 0.0 {
        let candidates = approaches(&plan, surface, cfg, roads, radius);
        let mut selected: Vec<_> = candidates
            .iter()
            .enumerate()
            .filter(|(i, s)| {
                cfg.suburbs == "many"
                    || rng
                        .fork(&format!("road:{i}"))
                        .chance(if s.rank <= 1 { 0.9 } else { 0.65 })
            })
            .map(|(_, s)| s.clone())
            .collect();
        if selected.is_empty() && cfg.suburbs != "auto" {
            selected.extend(candidates.first().cloned());
        }
        let weight: f64 = selected
            .iter()
            .map(|s| if s.rank <= 1 { 1.0 } else { 0.55 })
            .sum();
        let area = target_area * faub_weight / enc_weight;
        let depth =
            faub_morph.range("plotDepth", faub_zone)[1].clamp(15.0, (radius * 0.5).max(15.0));
        let mut shapes = vec![];
        let mut retained = vec![];
        for road in selected {
            let budget = area * if road.rank <= 1 { 1.0 } else { 0.55 } / weight;
            let glacis = if fortified { 22.0 } else { 0.0 };
            let available = length(&road.path);
            let run = (budget / (depth * 2.0 * 0.8) + glacis).min(available);
            if run < glacis + 15.0 {
                continue;
            }
            let path = cut_path(&road.path, run);
            if !matches!(road.role.as_str(), "bridge" | "ford" | "causeway")
                && !routing::path_clear(surface, &path, cfg.max_street_grade)
            {
                continue;
            }
            let widths: Vec<_> = (0..path.len())
                .map(|i| depth * 2.0 * if i + 1 == path.len() { 0.45 } else { 1.0 })
                .collect();
            let mut strips = g::ribbon(&path, &widths);
            // Walls protect the nucleus only; the unbuilt glacis stays rural.
            let blocked = if glacis > 0.0 {
                union(
                    &[
                        vec![plan.envelope.clone()],
                        g::ribbon(
                            &[plan.envelope.outer.clone(), vec![plan.envelope.outer[0]]].concat(),
                            &[glacis * 2.0],
                        ),
                    ]
                    .concat(),
                )
            } else {
                vec![plan.envelope.clone()]
            };
            for block in blocked {
                strips = strips
                    .iter()
                    .flat_map(|s| g::difference(s, &block))
                    .collect();
            }
            shapes.extend(strips.iter().flat_map(|s| g::dry_clip(&surface, s)));
            retained.push(Street {
                widths: vec![road.widths.first().copied().unwrap_or(5.0); path.len()],
                path,
                ..road
            });
        }
        let mut regions = union(&shapes);
        let shapes = regions.clone();
        for road in &retained {
            macroplan::split_by(&mut regions, road);
        }
        quarters.extend(
            regions
                .into_iter()
                .filter(|s| g::area(s) > 25.0)
                .map(|shape| Quarter {
                    shape,
                    phase: phases.len(),
                    zone: faub_zone.into(),
                }),
        );
        plan.streets.extend(retained);
        if shapes.is_empty() {
            plan.warnings.push("Aucun faubourg réalisable sur les approches de ce lieu ; leur budget reste visible dans la composition.".into());
        }
        phases.push(GrowthPhase {
            culture: culture.into(),
            kind: "faubourg".into(),
            zone: faub_zone.into(),
            recipe: faub_recipe,
            population: site.population as f64 * share,
            target_area: area,
            shapes,
        });
    }
    plan.quarters = quarters;
    if cfg.recipe != "auto" {
        for phase in &mut phases {
            phase.recipe = cfg.recipe.clone();
        }
    }
    Ok(Composition {
        plan,
        phases,
        archetype: if ribbon {
            "nucleated-village".into()
        } else {
            archetype.into()
        },
        nucleus_radius,
    })
}

/// Compose inherited land first, then share the armature across its chronological
/// sectors. Epoch boundaries partition ownership, not independent street engines.
fn generate_modern(
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
    let small = site.population < 1200;
    let initial_recipe = recipe(
        culture,
        site.population,
        if small { "village" } else { "core" },
    );
    let initial_zone = if cfg.zone != "auto" {
        cfg.zone.as_str()
    } else if small {
        "village"
    } else {
        "core"
    };
    let morph = super::with_tissue(
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
    let tick = std::time::Instant::now();
    let mut footprint = footprint::generate(seed, site, cfg, &morph, surface, roads, radius);
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  footprint: {:.0} ms",
            tick.elapsed().as_secs_f64() * 1000.0
        );
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
    for (component, domain) in domains.iter().enumerate() {
        if g::area(domain) < 25.0 {
            continue;
        }
        let center = footprint
            .structure
            .centers
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
        let mut part = macroplan::generate_domain(
            &format!("{seed}\u{1}component:{component}"),
            &local,
            &local_cfg,
            &morph,
            surface,
            &growth_roads,
            local.radius,
            Some(domain),
        );
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
        let zone = footprint::epoch_zone(cfg, site.population, epoch)
            .0
            .to_owned();
        let recipe = if cfg.recipe != "auto" {
            cfg.recipe.clone()
        } else {
            recipe(
                culture,
                site.population,
                if small {
                    "village"
                } else if epoch == 0 {
                    "core"
                } else {
                    "ring"
                },
            )
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
    fortify(
        &mut plan,
        &mut phases,
        culture,
        site,
        cfg,
        surface,
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
        quarter.zone = phases[epoch].zone.clone();
    }
    plan.warnings.append(&mut footprint.warnings);
    footprint.structure.metrics.components = domains.len();
    let archetype = footprint.structure.family.clone();
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
fn wards(s: &mut super::UrbanStructure, site: &Site, roads: &[Street]) {
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
/// Polygonal curtain fitted to a growth outline: straight runs between corners,
/// at most ~2 % of the town's width away from the land it encloses, and never
/// following the stair steps of the terrain raster along a bank.
/// Pieces of one town that only a river or a stream separates share one
/// circuit. A closing of the pieces (reach `WATER_REACH`) finds the narrow gaps
/// between them; a gap that is mostly water (the river and its banks) joins
/// the enclosure, so the curtain crosses the water on water gates instead of
/// running along both banks. Dry land between the arms is never enclosed.
const WATER_REACH: f64 = 60.0;
fn across_water(pieces: Vec<Shape>, surface: Surface<'_>) -> Vec<Shape> {
    use geo::{BooleanOps, Buffer, MultiPolygon};
    if pieces.len() < 2 {
        return pieces;
    }
    let town = MultiPolygon(pieces.iter().map(g::polygon).collect());
    let closed = town.buffer(WATER_REACH).buffer(-WATER_REACH);
    let wet_gaps: Vec<Shape> = g::shapes(closed.difference(&town))
        .into_iter()
        .filter(|gap| {
            let area = g::area(gap);
            let dry: f64 = g::dry_clip(&surface, gap).iter().map(g::area).sum();
            area > 50.0 && area - dry >= 0.25 * area
        })
        .collect();
    if wet_gaps.is_empty() {
        return pieces;
    }
    union(&pieces.into_iter().chain(wet_gaps).collect::<Vec<_>>())
}
/// Bank points of a closed curtain path where it passes from land to water, in
/// path order, each with `true` when the curtain enters the water there.
pub(super) fn water_gates(path: &[Point], surface: Surface<'_>) -> Vec<(Point, bool)> {
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
                out.push((if now { at(i - 1) } else { p }, now));
            }
            was = now;
        }
    }
    out
}
fn curtain(shape: &Shape, cell: f64) -> Shape {
    let tolerance = (g::area(shape).sqrt() * 0.02)
        .clamp(2.0, 10.0)
        .max(cell * 0.75);
    // Two corner-cutting passes turn growth-grid stair steps into slopes the
    // simplification can straighten; the curtain then runs in long straight sides.
    let mut ring = shape.outer.clone();
    for _ in 0..2 {
        let n = ring.len();
        ring = (0..n)
            .flat_map(|i| {
                let (a, b) = (ring[i], ring[(i + 1) % n]);
                [
                    Point {
                        x: a.x * 0.75 + b.x * 0.25,
                        y: a.y * 0.75 + b.y * 0.25,
                    },
                    Point {
                        x: a.x * 0.25 + b.x * 0.75,
                        y: a.y * 0.25 + b.y * 0.75,
                    },
                ]
            })
            .collect();
    }
    ring.push(ring[0]);
    let mut outer = g::simplify(&ring, tolerance, |_| false);
    outer.pop();
    if outer.len() < 3 {
        return shape.clone();
    }
    g::normalized(Shape {
        outer,
        holes: shape.holes.clone(),
    })
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
/// Split every quarter along a closed line, so no tissue street crosses it.
fn partition(quarters: &mut Vec<Quarter>, regions: &[Shape]) {
    if regions.is_empty() {
        return;
    }
    let mut out = vec![];
    for q in quarters.drain(..) {
        let mut outside = vec![q.shape.clone()];
        for r in regions {
            out.extend(
                g::intersection(&q.shape, r)
                    .into_iter()
                    .filter(|s| g::area(s) > 1.0)
                    .map(|shape| Quarter {
                        shape,
                        phase: q.phase,
                        zone: q.zone.clone(),
                    }),
            );
            outside = outside.iter().flat_map(|s| g::difference(s, r)).collect();
        }
        out.extend(
            outside
                .into_iter()
                .filter(|s| g::area(s) > 1.0)
                .map(|shape| Quarter {
                    shape,
                    phase: q.phase,
                    zone: q.zone.clone(),
                }),
        );
    }
    *quarters = out;
}
fn closed(ring: &[Point]) -> Vec<Point> {
    let mut path = ring.to_vec();
    if let Some(&p) = path.first() {
        path.push(p);
    }
    path
}
/// Gates are the real crossings of the network with the curtain: a street
/// passing through it, or street ends meeting on it from both sides. A street
/// that only ends on the curtain (a lane run up to the wall) opens no gate.
pub(super) fn gates(path: &[Point], streets: &[Street]) -> Vec<Point> {
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
fn fortify(
    plan: &mut macroplan::Plan,
    phases: &mut [GrowthPhase],
    culture: &str,
    site: &Site,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    morph: &Morph,
    small: bool,
    metropolis: bool,
) {
    let profile = profiles::settlement_profile(culture, site.population, cfg.phases);
    let kind = profiles::fortification(profile, &cfg.fortification, site.population);
    if !matches!(kind, "wall" | "palisade" | "hedge") || phases.is_empty() {
        return;
    }
    let epochs = phases.len();
    let walled = if small || epochs == 1 {
        epochs
    } else {
        epochs - 1
    };
    let cell = surface.width / surface.n as f64;
    // `trace`: "" (straight runs between corners), "hill" (contour trace) or
    // "bastioned" (long fronts between salients; `None` where it cannot fit).
    let enclosed = |count: usize, trace: &str| {
        across_water(
            union(
                &phases[..count]
                    .iter()
                    .flat_map(|p| p.shapes.clone())
                    .collect::<Vec<_>>(),
            ),
            surface,
        )
        .iter()
        // A hamlet-sized outlier gets no circuit of its own.
        .filter(|s| g::area(s) > 15_000.0)
        .map(|s| match trace {
            "hill" => Some(fortification::hill_trace(s, cell)),
            "bastioned" => fortification::bastioned_trace(&curtain(s, cell), surface),
            // A planned city's square circuit, where its land allows one.
            "square" => {
                let base = curtain(s, cell);
                Some(fortification::square_trace(&base, surface).unwrap_or(base))
            }
            _ => Some(curtain(s, cell)),
        })
        .collect::<Option<Vec<_>>>()
    };
    let Some(walls) = enclosed(walled, "") else {
        return;
    };
    if walls.is_empty() {
        return;
    }
    // Style inside the kind: culture, population, period, site and relief
    // (`fortification::resolve`); the trace then follows the style.
    let tick = std::time::Instant::now();
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
    let square = !style.hill
        && style.id == "wengcheng"
        && matches!(
            culture_data(culture, site.population)["core"]["enclosure"]["shape"].as_str(),
            Some("square" | "rect")
        );
    let walls = if style.hill {
        enclosed(walled, "hill").unwrap_or(walls)
    } else if square {
        enclosed(walled, "square").unwrap_or(walls)
    } else if style.id == "bastioned" {
        match enclosed(walled, "bastioned") {
            Some(traced) => traced,
            None => {
                plan.warnings.push(
                    "Fortification : tracé bastionné impossible sur ce contour, enceinte flanquée conservée."
                        .into(),
                );
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
    let inner_style = style.inner(culture, site.population);
    let data = culture_data(culture, site.population);
    let fossil = data["core"]["enclosure"]["fossil"]
        .as_str()
        .unwrap_or("none");
    let mut inner_walls = vec![];
    // A metropolis keeps every older circuit: each became a ring boulevard
    // when the next wall was built (unless the culture keeps inner walls).
    let fossil = if metropolis && fossil != "wall" {
        "street"
    } else {
        fossil
    };
    let circuits = if metropolis { walled } else { walled.min(2) };
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
            partition(&mut plan.quarters, &old);
            inner_walls.extend(old);
        }
    }
    partition(&mut plan.quarters, &walls);
    let first = plan.enclosures.len();
    let outer = walls.len();
    // Gate passages and causeways are cut at the width the street hierarchy
    // gives these streets later (through routes become arterial gate streets).
    let rank_base: [f64; 5] = std::array::from_fn(|r| {
        morph.value["widthByRank"][r].as_f64().unwrap_or(3.0) * morph.number_or("widthScale", 1.0)
    });
    let table = super::network::rank_widths(rank_base, site.population);
    let predicted = fortification::Predicted {
        widths: table.map(|w| w * 1.1),
        arterial: if site.population >= 20_000 { 0 } else { 1 },
        dwelling: super::culture::mapping_for(culture, &cfg.programme.period).map_or([5.0, 5.0], |m| {
            [m.admissibility.min_frontage, m.admissibility.min_depth]
        }),
    };
    for (i, wall) in walls.iter().chain(&inner_walls).enumerate() {
        let path = closed(&wall.outer);
        let mut gates = gates(&path, &plan.streets);
        let land = gates.len();
        // Where the curtain crosses a river it opens on a water gate.
        let banks = water_gates(&path, surface);
        for &(p, _) in &banks {
            if !gates.iter().any(|q| (p.x - q.x).hypot(p.y - q.y) < 8.0) {
                gates.push(p);
            }
        }
        let mut enclosure = Enclosure {
            path,
            kind: kind.into(),
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
            if i < outer { &style } else { &inner_style },
            site.population,
            &predicted,
            &base.fork(&format!("enc:{i}")),
        );
        plan.streets.extend(lanes);
        plan.enclosures.push(enclosure);
    }
    // No quarter keeps land in a tower, a ditch or a glacis.
    fortification::yield_reserve(&mut plan.quarters, &plan.enclosures[first..]);
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
}
