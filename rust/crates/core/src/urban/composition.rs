//! Settlement composition, before quarter and block subdivision. Cultural phase
//! thresholds, population shares and road ribbons follow the TypeScript planner.
use super::{
    Enclosure, GrowthPhase, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    UrbanCenter, UrbanEvent, catalogue, footprint, fortification, geometry as g, kinds::Kind,
    macroplan, profiles, resolve, routing,
};
#[path = "composition_faubourgs.rs"]
mod faubourgs;
pub(super) use faubourgs::{prepare_gate_villages, gate_service_cost, gate_demands, gate_morph, gate_activity, gate_pressures, grow_gate_villages};
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

/// A zone chosen in the phase table keeps its own culture and recipe: the global
/// recipe, preset and zone only apply to the zones that were not chosen.
pub(super) fn zone_chosen(
    overrides: &std::collections::BTreeMap<String, super::PhaseOverride>,
    zone: &str,
) -> bool {
    overrides
        .get(zone)
        .is_some_and(|o| !o.culture.is_empty() || !o.recipe.is_empty())
}

/// `(preset, selected recipe)` to resolve a phase with: the globals, or the
/// culture's own when the zone was chosen.
pub(super) fn globals<'a>(chosen: bool, preset: &'a str, selected: &'a str) -> (&'a str, &'a str) {
    if chosen { ("culture", "auto") } else { (preset, selected) }
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
    // Village-or-smaller and hamlet-or-smaller follow the shared demographic classes.
    let small = crate::settlements::demographics::below(site.population, "town");
    let rural = crate::settlements::demographics::below(site.population, "village");
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
        } else if small && footprint::enclosed(cfg, culture, site.population) {
            "core"
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
    let parts = super::par::map(&domains, |component, domain| {
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
/// Morphological closing (grow then shrink by `reach`). geo's offset never
/// ends on a ring with long runs of millimetre zigzag edges (a 150k
/// persian+medina outline carried 1236 edges under 5 cm along 6 m); the
/// closing only looks for gaps metres wide, so it drops sub-centimetre detail.
pub(super) fn closing(shapes: &geo::MultiPolygon<f64>, reach: f64) -> geo::MultiPolygon<f64> {
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
fn curtain(shape: &Shape, cell: f64, small: bool) -> Shape {
    if small { fortification::village_trace(shape, cell, false) }
    else { fortification::curtain_trace(shape) }
}

/// A house stands within a few metres of a street, so only the strip of a block
/// along a street is built land: the deep back of a big block (gardens, an empty
/// field behind the first lots) is not.
const FRONT_REACH: f64 = 35.0;
/// Blocks smaller than this (m²) are built whole: their back is not worth a cut.
const BIG_BLOCK: f64 = 2_500.0;

/// Land within `FRONT_REACH` of a street, as shapes.
fn street_reach(layout: &super::Layout) -> Vec<Shape> {
    // One ribbon per street, then one union: buffering the whole multi-line
    // network at once (geo `Buffer`) never ends on a dense, overlapping network.
    // `ribbon` already rounds the interior joins; the two ends get a disc so the
    // reach is a true round-capped buffer, as before.
    let cap = |c: &Point| Shape {
        outer: (0..16).map(|k| { let a = k as f64 * std::f64::consts::TAU / 16.0; Point { x: c.x + FRONT_REACH * a.cos(), y: c.y + FRONT_REACH * a.sin() } }).collect(),
        holes: vec![],
    };
    // Per-street buffers are independent; collect in street order before the
    // unchanged union, so its integer overlay grid and operand order stay exact.
    let ribbons: Vec<Shape> = super::par::map(&layout.streets, |_, s| {
        if s.path.len() < 2 || s.role == "bridge" { return vec![]; }
        let mut v = g::ribbon(&s.path, &vec![2.0 * FRONT_REACH; s.path.len()]);
        v.push(cap(&s.path[0]));
        v.push(cap(&s.path[s.path.len() - 1]));
        v
    }).into_iter().flatten().collect();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::union(&ribbons))).unwrap_or_default()
}

/// The built part of a block of kind "block": whole when small or when no street
/// is known, else its strip along the streets.
fn built_part(shape: &Shape, reach: &[Shape]) -> Vec<Shape> {
    if reach.is_empty() || g::area(shape) < BIG_BLOCK { return vec![shape.clone()]; }
    let (x0, y0, x1, y1) = g::bbox(shape);
    let part: Vec<Shape> = reach.iter().filter(|r| { let b = g::bbox(r); b.0 <= x1 && b.2 >= x0 && b.1 <= y1 && b.3 >= y0 })
        .flat_map(|r| g::intersection(shape, r)).filter(|s| g::area(s) > 50.0).collect();
    part
}

/// Share of a town circuit that may stay empty in one piece (no block, no
/// declared open space) before the curtain is drawn back to the built town.
const VOID_SHARE: f64 = 0.05;
/// Smallest empty piece (m²) that moves a curtain, whatever the circuit size.
const VOID_MIN: f64 = 15_000.0;
/// Reach (m) of the built edge kept inside a refitted curtain: a street and the wall lane.
const VOID_MARGIN: f64 = 30.0;

/// Circuits follow the blocks that survived the occupancy trim: a broad land
/// claim is not a defensive perimeter around an empty field or slope.
/// Mountain (terrace) towns refit thin circuits to their blocks, then, like every
/// other town circuit, give back the dry land the allocation left empty
/// (`fit_to_built`). Degenerate circuits (no area) are dropped.
pub(super) fn fit_enclosures(layout: &mut super::Layout, population: u32, surface: Surface<'_>) {
    use geo::Buffer;
    layout.enclosures.retain(|e| !e.purpose.is_empty() || e.path.len() < 4
        || g::area(&Shape { outer: e.path.clone(), holes: vec![] }) >= 50.0);
    let cfg = layout.config.clone().unwrap_or_default();
    let profile = profiles::settlement_profile(&layout.culture,population,cfg.phases);
    if !profile.stairs || profile.pattern != "terraces" { return fit_to_built(layout, surface); }
    // Built land: ordinary blocks and programme reservations, not open commons or fields.
    let reserved: std::collections::HashSet<_> = layout.programme.iter().flat_map(|p|p.reservations.iter()
        .filter(|r|!p.demands.iter().any(|d|d.id==r.demand_id && d.role.starts_with("open.")))).map(|r|r.block).collect();
    let reach = street_reach(layout);
    let kept: Vec<&super::Block> = layout.blocks.iter().enumerate()
        .filter(|(i,b)|matches!(b.kind.as_str(),"block"|"place") || reserved.contains(i)).map(|(_,b)|b).collect();
    // Per-block clips are independent: in parallel, flattened in block order.
    let occupied: Vec<_> = super::par::map(&kept, |_, b| if b.kind == "block" { built_part(&b.shape,&reach) } else { vec![b.shape.clone()] })
        .into_iter().flatten().collect();
    let mut result = vec![];
    for e in &layout.enclosures {
        if !e.purpose.is_empty() { result.push(e.clone());continue; }
        let old = Shape {outer:e.path.clone(),holes:vec![]};
        let land: Vec<_> = occupied.iter().flat_map(|s|g::intersection(s,&old)).filter(|s|g::area(s)>50.).collect();
        // A circuit around no built land (an open field, a strip) is not raised.
        if land.is_empty() { continue; }
        if land.iter().map(g::area).sum::<f64>() >= g::area(&old)*0.35 {
            result.push(e.clone());continue;
        }
        let margin: Vec<_> = land.iter().flat_map(|s|g::shapes(g::polygon(s).buffer(18.))).collect();
        let fitted: Vec<_> = union(&margin).iter().flat_map(|s|g::intersection(s,&old))
            .flat_map(|s|g::dry_clip(&surface,&s)).filter(|s|g::area(s)>5000.)
            .filter(|s|land.iter().any(|b|g::contains(s,g::interior_point(b)))).collect();
        if fitted.is_empty() { result.push(e.clone());continue; }
        for shape in fitted {
            let trace = fortification::hill_trace(&shape,surface.width/surface.n.max(1) as f64);
            let mut path = trace.outer;
            path.push(path[0]);
            if result.iter().any(|e:&Enclosure| e.path==path) {continue;}
            result.push(Enclosure {gates:gates(&path,&layout.streets),path,kind:e.kind.clone(),..Default::default()});
        }
    }
    layout.enclosures = result;
    // The same invariant as every town circuit: a big empty piece beside the town is given back.
    fit_to_built(layout, surface);
}

/// Longest refitted curtain, as a share of the circuit it replaces.
const MAX_REFIT_GROWTH: f64 = 1.05;

/// A town circuit holds its town: dry land more than `VOID_MARGIN` from any
/// built block, place or programme reservation (open spaces included) is
/// empty; empty pieces of at least `max(VOID_SHARE × circuit, VOID_MIN)` are
/// cut out and the curtain is retraced round what is left. Water is never
/// empty land, so a circuit keeps its river crossings. The refitted circuit
/// carries no works yet: `fortification::settle` builds it.
fn fit_to_built(layout: &mut super::Layout, surface: Surface<'_>) {
    use geo::{BooleanOps, Buffer, MultiPolygon};
    if !layout.enclosures.iter().any(|e| e.purpose.is_empty() && e.path.len() >= 4) { return; }
    let reserved: std::collections::HashSet<_> = layout.programme.iter().flat_map(|p| p.reservations.iter().map(|r| r.block)).collect();
    let reach = street_reach(layout);
    let kept: Vec<&super::Block> = layout.blocks.iter().enumerate()
        .filter(|(i, b)| matches!(b.kind.as_str(), "block" | "place") || reserved.contains(i)).map(|(_, b)| b).collect();
    // Per-block clips are independent: in parallel, flattened in block order.
    let occupied: Vec<(Shape, (f64, f64, f64, f64))> = super::par::map(&kept, |_, b|
            if b.kind == "block" { built_part(&b.shape, &reach) } else { vec![b.shape.clone()] })
        .into_iter().flatten()
        .map(|s| { let bb = g::bbox(&s); (s, bb) }).collect();
    let safe = |f: &dyn Fn() -> MultiPolygon<f64>| std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).ok();
    let mp = |v: &[Shape]| MultiPolygon(v.iter().map(g::polygon).collect());
    let mut result = Vec::with_capacity(layout.enclosures.len());
    for e in std::mem::take(&mut layout.enclosures) {
        if !e.purpose.is_empty() || e.path.len() < 4 { result.push(e); continue; }
        let old = g::normalized(Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] });
        let (area, (x0, y0, x1, y1)) = (g::area(&old), g::bbox(&old));
        let near: Vec<Shape> = occupied.iter().filter(|(_, b)| b.0 <= x1 && b.2 >= x0 && b.1 <= y1 && b.3 >= y0)
            .map(|(s, _)| s.clone()).collect();
        let Some(reach) = safe(&|| mp(&near).buffer(VOID_MARGIN)) else { result.push(e); continue; };
        let dry = mp(&g::dry_clip(&surface, &old));
        let Some(empty) = safe(&|| dry.difference(&reach)) else { result.push(e); continue; };
        let floor = (VOID_SHARE * area).max(VOID_MIN);
        // The new front runs in straight stretches (10 m tolerance, within the margin).
        let void: Vec<Shape> = g::shapes(empty).into_iter().filter(|s| g::area(s) >= floor)
            .map(|s| { let mut r = g::simplify(&closed(&s.outer), 10.0, |_| false); r.pop(); g::normalized(Shape { outer: r, holes: vec![] }) })
            .filter(|s| s.outer.len() >= 3 && g::simple(s)).collect();
            if void.is_empty() { result.push(e); continue; }
        // A circuit round no built land at all is not raised.
        if near.iter().all(|s| g::intersection(s, &old).is_empty()) { continue; }
        let Some(kept) = safe(&|| g::polygon(&old).difference(&mp(&void))) else { result.push(e); continue; };
        let mut refit = vec![];
        for piece in g::shapes(kept) {
            if g::area(&piece) < floor || !near.iter().any(|s| g::contains(&piece, g::interior_point(s))) { continue; }
            // The kept curtain stays where it was; only the cut is new.
            // Out-and-back runs of the old trace (along a bank) are dropped here.
            let mut ring = g::simplify(&closed(&g::unneedled(&g::cleaned(&piece).outer, 0.5)), 1.0, |_| false);
            ring.pop();
            let plain = g::normalized(Shape { outer: g::unneedled(&ring, 0.5), holes: vec![] });
            let trace = if g::simple(&plain) { plain } else { fortification::curtain_trace(&Shape { outer: piece.outer, holes: vec![] }) };
            if trace.outer.len() < 3 || !g::simple(&trace) { refit.clear(); break; }
            refit.push(closed(&trace.outer));
        }
        if refit.is_empty() { result.push(e); continue; }
        // A curtain that gives land back never grows: tracing round thin arms of houses
        // would raise a longer, tentacled wall (review 04/11, giant-hold 10k).
        if refit.iter().map(|p| length(p)).sum::<f64>() > MAX_REFIT_GROWTH * length(&e.path) { result.push(e); continue; }
        for path in refit {
            result.push(Enclosure { gates: gates(&path, &layout.streets), path, kind: e.kind.clone(), ..Default::default() });
        }
    }
    layout.enclosures = result;
}

#[cfg(test)]
mod built_fit_tests {
    use super::*;
    /// Review 03/11 (indus 10k river): a town circuit gives back the empty
    /// slope beside its town; a circuit whose land is built stays as it is.
    #[test]
    fn review11_town_circuit_gives_back_its_empty_side() {
        let layout = |blocks: serde_json::Value| -> crate::urban::Layout { serde_json::from_value(serde_json::json!({
            "key":"built-fit","culture":"indus-planned","center":{"x":300.,"y":200.},"quarters":[],"streets":[],"warnings":[],
            "blocks":blocks,
            "enclosures":[{"kind":"wall","path":[{"x":0.,"y":0.},{"x":600.,"y":0.},{"x":600.,"y":400.},{"x":0.,"y":400.},{"x":0.,"y":0.}],"gates":[],"towers":[],"style":"flanked"}]
        })).unwrap() };
        let block = |x0: f64, x1: f64, kind: &str| serde_json::json!({"shape":g::rectangle(x0,10.,x1,390.),"quarter":0,"kind":kind,"axis":{"x":1.,"y":0.}});
        let (h, w) = (vec![0.; 16 * 16], vec![0; 16 * 16]);
        let surface = Surface { geometry: None, width: 1024., n: 16, height: &h, water: &w, interpolation: Default::default(),};
        // Built east half, trimmed (reserve) west half: the curtain moves to the town.
        let mut l = layout(serde_json::json!([block(310.,590.,"block"), block(10.,300.,"reserve")]));
        fit_enclosures(&mut l, 10000, surface);
        assert_eq!(l.enclosures.len(), 1);
        let fitted = Shape { outer: l.enclosures[0].path.clone(), holes: vec![] };
        assert!(g::contains(&fitted, Point { x: 450., y: 200. }) && !g::contains(&fitted, Point { x: 100., y: 200. }));
        assert!(g::area(&fitted) < 0.65 * 240_000.0, "{}", g::area(&fitted));
        assert!(l.enclosures[0].style.is_empty(), "the refitted circuit is rebuilt by settle");
        // Built everywhere (a place counts): the circuit is untouched.
        let mut l = layout(serde_json::json!([block(310.,590.,"block"), block(10.,300.,"place")]));
        let before = l.enclosures[0].path.clone();
        fit_enclosures(&mut l, 10000, surface);
        assert_eq!(l.enclosures.len(), 1);
        assert_eq!(l.enclosures[0].path, before);
    }
}

#[cfg(test)]
mod side_by_side_tests {
    use super::*;
    static FLAT: [f32; 256] = [0.0; 256];
    static DRY: [u8; 256] = [0; 256];
    fn surface() -> Surface<'static> { Surface { geometry: None, width: 2048., n: 16, height: &FLAT, water: &DRY, interpolation: Default::default(),} }
    fn layout(rings: &[Shape]) -> crate::urban::Layout {
        let mut l: crate::urban::Layout = serde_json::from_value(serde_json::json!({
            "key":"side-by-side","culture":"dwarven","center":{"x":0.,"y":0.},"quarters":[],"streets":[],"warnings":[],"blocks":[],"enclosures":[]
        })).unwrap();
        l.enclosures = rings.iter().map(|r| Enclosure { path: closed(&r.outer), kind: "wall".into(), ..Default::default() }).collect();
        l
    }
    /// Review 03/11 (dwarven town): two circuits running side by side are
    /// joined into one; distant, nested and attached circuits stay apart.
    #[test]
    fn review11_side_by_side_circuits_become_one() {
        let (town, annex) = (g::rectangle(0., 0., 400., 400.), g::rectangle(430., 60., 600., 300.));
        let mut l = layout(&[town.clone(), annex.clone()]);
        join_side_by_side(&mut l, surface());
        assert_eq!(l.enclosures.len(), 1);
        let one = closed_shape(&l.enclosures[0]);
        for p in [Point { x: 200., y: 200. }, Point { x: 515., y: 180. }, Point { x: 415., y: 180. }] {
            assert!(g::contains(&one, p), "{p:?} outside the joined circuit");
        }
        assert!(l.enclosures[0].style.is_empty(), "the joined circuit is rebuilt by settle");
        // The joined circuit runs straight across a bend that turned into the town.
        let dented = Shape { outer: vec![Point { x: 0., y: 0. }, Point { x: 400., y: 0. }, Point { x: 400., y: 400. }, Point { x: 250., y: 400. },
            Point { x: 200., y: 330. }, Point { x: 150., y: 400. }, Point { x: 0., y: 400. }], holes: vec![] };
        let mut l = layout(&[dented, annex.clone()]);
        join_side_by_side(&mut l, surface());
        assert_eq!(l.enclosures.len(), 1);
        assert!(g::contains(&closed_shape(&l.enclosures[0]), Point { x: 200., y: 380. }), "inward bend kept");
        // Two traces touching at a corner (a few metres of overlap) are side by side too.
        let mut l = layout(&[town.clone(), g::rectangle(395., 60., 600., 300.)]);
        join_side_by_side(&mut l, surface());
        assert_eq!(l.enclosures.len(), 1);
        let far = g::rectangle(700., 60., 900., 300.);
        let inner = g::rectangle(100., 100., 300., 300.);
        let attached = g::rectangle(400., 0., 600., 400.);
        for rings in [vec![town.clone(), far], vec![town.clone(), inner], vec![town.clone(), attached]] {
            let mut l = layout(&rings);
            join_side_by_side(&mut l, surface());
            assert_eq!(l.enclosures.len(), 2);
        }
    }
}
#[cfg(test)]
mod wall_density_tests {
    use super::*;
    #[test]
    fn terrace_perimeter_keeps_occupied_blocks_and_releases_empty_slope() {
        let mut l: crate::urban::Layout = serde_json::from_value(serde_json::json!({
            "key":"terrace-perimeter","culture":"dwarven","center":{"x":50.,"y":50.},"quarters":[],"streets":[],"warnings":[],
            "blocks":[{"shape":g::rectangle(10.,10.,90.,90.),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}},
                {"shape":g::rectangle(100.,0.,500.,500.),"quarter":0,"kind":"reserve","axis":{"x":1.,"y":0.}}],
            "enclosures":[{"kind":"wall","path":[{"x":0.,"y":0.},{"x":500.,"y":0.},{"x":500.,"y":500.},{"x":0.,"y":500.},{"x":0.,"y":0.}],"gates":[],"towers":[]}]
        })).unwrap();
        let h = vec![0.;16*16];let w = vec![0;16*16];
        fit_enclosures(&mut l,10000,Surface {geometry:None,width:512.,n:16,height:&h,water:&w, interpolation: Default::default(),});
        assert_eq!(l.enclosures.len(),1);
        let sh = Shape {outer:l.enclosures[0].path.clone(),holes:vec![]};
        assert!(g::contains(&sh,Point {x:50.,y:50.}));
        assert!(g::area(&sh)<25_000.);
    }
}
/// Half the widest gap (m) between two town circuits that stand side by side.
const JOIN_REACH: f64 = 40.0;
/// Two town circuits side by side are one circuit. Where their rings run
/// within `2 × JOIN_REACH` of each other (without overlapping, nesting or
/// sharing a stretch, as an attached extension does), the land between them
/// joins the enclosure and a single curtain runs round both. The joined
/// circuit carries no works yet: `fortification::settle` builds it.
pub(super) fn join_side_by_side(layout: &mut super::Layout, surface: Surface<'_>) {
    use geo::{BooleanOps, Buffer, MultiPolygon};
    let town = |e: &Enclosure| e.purpose.is_empty() && e.path.len() >= 4;
    let grown = |s: &Shape, d: f64| std::panic::catch_unwind(std::panic::AssertUnwindSafe(||
        g::shapes(g::polygon(s).buffer(d)))).unwrap_or_default();
    // A pair refused once is refused again while neither circuit changes:
    // circuits carry ids, a join gives the merged one a new id.
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
                let merged = union(&[sa, sb].into_iter().chain(gaps).collect::<Vec<_>>());
                let [one] = merged.as_slice() else { continue; };
                let trace = fortification::straight_across(&fortification::curtain_trace(&Shape { outer: one.outer.clone(), holes: vec![] }), surface);
                if trace.outer.len() < 3 || !g::simple(&trace) { continue; }
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
/// Boxes `a` and `b` overlap or touch, within `margin`.
fn boxes_meet(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64), margin: f64) -> bool {
    a.0 <= b.2 + margin && b.0 <= a.2 + margin && a.1 <= b.3 + margin && b.1 <= a.3 + margin
}
/// Straight curtains can leave narrow dry strips beyond the growth outline.
/// Give that land to an adjoining quarter; the later ribbons cut the ring road.
/// Returns the dry gaps no quarter could take (cut off by a street).
fn fit_enclosed_quarters(quarters: &mut [Quarter], walls: &[Shape], streets: &[Street], surface: Surface<'_>) -> Vec<Shape> {
    if walls.is_empty() {
        return vec![];
    }
    use geo::Intersects;
    let occupied = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let mut gaps = walls.to_vec();
    for shape in &occupied {
        gaps = gaps.iter().flat_map(|s| g::difference(s, shape)).collect();
    }
    // Separate the strips at real roads, so a belt cannot all join one ward.
    // Only the ribbons crossing a gap are cut (a large town has many streets,
    // and a belt along a whole circuit has the town's box).
    let mut boxes: Vec<_> = gaps.iter().map(|s| (g::bbox(s), g::polygon(s))).collect();
    for st in streets {
        for ribbon in g::ribbon(&st.path, &st.widths) {
            let b = g::bbox(&ribbon);
            if !boxes.iter().any(|(gb, _)| boxes_meet(*gb, b, 0.0)) {
                continue;
            }
            let rp = g::polygon(&ribbon);
            let hit: Vec<bool> = boxes.iter().map(|(gb, gp)| boxes_meet(*gb, b, 0.0) && gp.intersects(&rp)).collect();
            if !hit.contains(&true) {
                continue;
            }
            gaps = gaps.iter().zip(&hit)
                .flat_map(|(s, &h)| if h { g::difference(s, &ribbon) } else { vec![s.clone()] })
                .collect();
            boxes = gaps.iter().map(|s| (g::bbox(s), g::polygon(s))).collect();
        }
    }
    // The gap shares a stretch of the quarter's outline (a vertex of the gap
    // lies on one of its rings): only then can they join in one piece.
    let adjoins = |q: &Shape, gap: &Shape| {
        let (x0, y0, x1, y1) = g::bbox(q);
        gap.outer.iter().chain(gap.holes.iter().flatten())
            .filter(|p| p.x >= x0 - 0.5 && p.x <= x1 + 0.5 && p.y >= y0 - 0.5 && p.y <= y1 + 0.5)
            .any(|&p| std::iter::once(&q.outer).chain(&q.holes).any(|r| {
                let n = r.len();
                (0..n).any(|i| g::distance(p, r[i], r[(i + 1) % n]).0 < 0.5)
            }))
    };
    let mut left = vec![];
    for gap in gaps.iter().flat_map(|s| g::dry_clip(&surface, s)) {
        let mut best = None;
        let reach = g::bbox(&gap);
        for (i, q) in quarters.iter().enumerate() {
            // A quarter clear of the gap cannot join it in one piece.
            if !boxes_meet(g::bbox(&q.shape), reach, 0.5) || !adjoins(&q.shape, &gap) {
                continue;
            }
            let merged = g::union(&[q.shape.clone(), gap.clone()]);
            if merged.len() != 1 { continue; }
            let added = g::area(&merged[0]) - g::area(&q.shape);
            if added < g::area(&gap) * 0.99 { continue; }
            let center = g::centroid(&q.shape);
            let c = g::centroid(&gap);
            let score = (center.x - c.x).hypot(center.y - c.y);
            if best.as_ref().is_none_or(|(_, _, old)| score < *old) {
                best = Some((i, merged.into_iter().next().unwrap(), score));
            }
        }
        match best {
            Some((i, shape, _)) => quarters[i].shape = shape,
            None => left.push(gap),
        }
    }
    left
}
/// The curtain is a rectangle: it fills most of its own tightest rectangle (a
/// corner given back to the water still counts).
fn rectangular(wall: &Shape) -> bool {
    use geo::MinimumRotatedRect;
    g::polygon(wall).minimum_rotated_rect().is_some_and(|r| {
        let tight = g::area(&g::shapes(geo::MultiPolygon(vec![r]))[0]);
        tight > 0.0 && g::area(wall) >= 0.85 * tight
    })
}
/// Frame of a planned street grid: the length-weighted mean direction of the
/// quarter edges modulo a right angle, in (-45°, 45°]. `None` when the edges
/// share no dominant pair of axes (an organic plan).
fn grid_frame(quarters: &[Quarter]) -> Option<f64> {
    let (mut c, mut s, mut total) = (0.0, 0.0, 0.0);
    for q in quarters {
        let n = q.shape.outer.len();
        for i in 0..n {
            let (a, b) = (q.shape.outer[i], q.shape.outer[(i + 1) % n]);
            let l = (b.x - a.x).hypot(b.y - a.y);
            let t = 4.0 * (b.y - a.y).atan2(b.x - a.x);
            (c, s, total) = (c + l * t.cos(), s + l * t.sin(), total + l);
        }
    }
    (total > 0.0 && c.hypot(s) >= 0.5 * total).then(|| s.atan2(c) / 4.0)
}
/// An enceinte (square or polygonal trace) is walled land, filled to its wall
/// street: every dry gap between the curtain and the quarters joins an
/// adjoining quarter, or becomes a quarter of its own where a street cuts it off
/// from them, and joins the land of the nearest walled epoch. Turned grids,
/// river bends and an irregular founding outline then leave no empty strip or
/// wedge in the walls.
fn fill_enclosures(
    quarters: &mut Vec<Quarter>,
    phases: &mut [GrowthPhase],
    walls: &[Shape],
    walled: usize,
    streets: &[Street],
    surface: Surface<'_>,
) {
    if walls.is_empty() {
        return;
    }
    let before = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let left = fit_enclosed_quarters(quarters, walls, streets, surface);
    // Narrow slivers (under ~6 m across) stay with the wall street.
    let wide = |s: &Shape| {
        let n = s.outer.len();
        let perimeter: f64 = (0..n).map(|i| {
            let (a, b) = (s.outer[i], s.outer[(i + 1) % n]);
            (b.x - a.x).hypot(b.y - a.y)
        }).sum();
        let a = g::area(s);
        a >= 800.0 && 2.0 * a >= 6.0 * perimeter
    };
    let added: Vec<Shape> = left.into_iter().filter(|s| wide(s)).collect();
    // Epoch of a piece of land: the nearest walled epoch.
    let epochs = walled.min(phases.len());
    let epoch_of = |phases: &[GrowthPhase], p: Point| {
        (0..epochs).filter(|&e| !phases[e].shapes.is_empty()).min_by(|&a, &b| {
            let d = |e: usize| phases[e].shapes.iter().flat_map(|s| s.outer.iter())
                .map(|q| (q.x - p.x).hypot(q.y - p.y)).fold(f64::INFINITY, f64::min);
            d(a).total_cmp(&d(b))
        })
    };
    for shape in &added {
        if let Some(e) = epoch_of(phases, g::interior_point(shape)) {
            quarters.push(Quarter { shape: shape.clone(), phase: e, zone: phases[e].zone.clone() });
        }
    }
    // The land the quarters gained joins its epoch, outside every epoch's own land.
    let mut gained: Vec<Shape> = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    for shape in &before {
        gained = gained.iter().flat_map(|s| g::difference(s, shape)).collect();
    }
    for shape in phases.iter().flat_map(|p| p.shapes.iter()) {
        if !gained.is_empty() {
            gained = gained.iter().flat_map(|s| g::difference(s, shape)).collect();
        }
    }
    for piece in gained.into_iter().filter(|s| g::area(s) > 1.0) {
        if let Some(e) = epoch_of(phases, g::interior_point(&piece)) {
            phases[e].shapes.push(piece);
        }
    }
}

#[test]
fn enclosed_quarters_reach_the_ring_road_without_claiming_water() {
    let mut quarters = vec![Quarter { shape:g::rectangle(20.,20.,80.,80.), phase:0, zone:"core".into() }];
    let wall = g::rectangle(10.,10.,90.,90.);
    let road = Street { path:vec![Point{x:10.,y:50.},Point{x:90.,y:50.}],widths:vec![4.;2],rank:1,role:"street".into() };
    let height = vec![10.;100];
    let water: Vec<_> = (0..100).map(|i|u8::from(i % 10 >= 8)).collect();
    let surface = Surface {geometry:None,width:100.,n:10,height:&height,water:&water, interpolation: Default::default(),};
    fit_enclosed_quarters(&mut quarters, std::slice::from_ref(&wall), std::slice::from_ref(&road), surface);
    let added = g::difference(&quarters[0].shape, &g::rectangle(20.,20.,80.,80.));
    let road = g::rectangle(10.,48.,90.,52.);
    assert!(added.iter().map(g::area).sum::<f64>() > 1000.);
    assert!(added.iter().flat_map(|s|g::intersection(s,&road)).map(|s|g::area(&s)).sum::<f64>() < 0.01);
    assert!(g::difference(&quarters[0].shape,&wall).iter().map(g::area).sum::<f64>() < 0.01);
    assert!((g::area(&quarters[0].shape) - g::dry_clip(&surface,&quarters[0].shape).iter().map(g::area).sum::<f64>()).abs() < 0.01);
}

#[test]
fn rectangular_enclosure_runs_on_its_grid_and_is_filled_to_the_wall() {
    let (height, water) = (vec![10.; 100], vec![0u8; 100]);
    let surface = Surface { geometry: None, width: 1000., n: 10, height: &height, water: &water, interpolation: Default::default() };
    let turn = |a: f64, x: f64, y: f64| Point { x: 500. + x * a.cos() - y * a.sin(), y: 500. + x * a.sin() + y * a.cos() };
    let square = |a: f64, x0: f64, y0: f64, x1: f64, y1: f64| g::normalized(Shape {
        outer: vec![turn(a, x0, y0), turn(a, x1, y0), turn(a, x1, y1), turn(a, x0, y1)], holes: vec![] });
    let axes = |s: &Shape| -> Vec<f64> {
        let n = s.outer.len();
        (0..n).map(|i| { let (a, b) = (s.outer[i], s.outer[(i + 1) % n]);
            (b.y - a.y).atan2(b.x - a.x).to_degrees().rem_euclid(90.0) }).collect()
    };
    // A grid turned 3° from the compass: the cardinal box is tight enough for a
    // cardinal culture, but the circuit now runs on the grid's own axes.
    let a = 3f64.to_radians();
    let outline = square(a, -150., -100., 150., 100.);
    let cardinal = fortification::square_trace(&outline, surface, true, false, None).unwrap();
    assert!(axes(&cardinal).iter().all(|d| d.min(90. - d) < 0.5), "{:?}", axes(&cardinal));
    let quarters: Vec<Quarter> = [(-150., -100.), (0., -100.), (-150., 0.), (0., 0.)].iter()
        .map(|&(x, y)| Quarter { shape: square(a, x, y, x + 150., y + 100.), phase: 0, zone: "core".into() }).collect();
    let grid = grid_frame(&quarters).unwrap();
    assert!((grid.to_degrees() - 3.).abs() < 0.1, "{}", grid.to_degrees());
    let wall = fortification::square_trace(&outline, surface, true, false, Some(grid)).unwrap();
    assert!(axes(&wall).iter().all(|d| (d - 3.).abs() < 0.5), "{:?}", axes(&wall));
    assert!(rectangular(&wall) && g::area(&wall) < 1.05 * g::area(&outline));
    // A 20° grid in a cardinal box (a forced rectangle): the four corner wedges
    // join the town; the one a street cuts off becomes a quarter of its own.
    let a = 20f64.to_radians();
    let mut quarters: Vec<Quarter> = [(-100., -100.), (0., -100.), (-100., 0.), (0., 0.)].iter()
        .map(|&(x, y)| Quarter { shape: square(a, x, y, x + 100., y + 100.), phase: 0, zone: "core".into() }).collect();
    let outline = square(a, -100., -100., 100., 100.);
    let (x0, y0, x1, y1) = g::bbox(&outline);
    let wall = g::rectangle(x0, y0, x1, y1);
    let street = Street { path: vec![turn(a, -120., 100.), turn(a, 120., 100.)], widths: vec![6.; 2], rank: 1, role: "street".into() };
    let mut phases = vec![GrowthPhase { culture: "chinese".into(), kind: "foundation".into(), zone: "core".into(), recipe: String::new(),
        population: 1000., target_area: 40_000., shapes: vec![outline.clone()] }];
    fill_enclosures(&mut quarters, &mut phases, std::slice::from_ref(&wall), 1, std::slice::from_ref(&street), surface);
    let covered: f64 = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>()).iter().map(g::area).sum();
    assert!(covered >= 0.97 * g::area(&wall), "{covered} of {}", g::area(&wall));
    assert_eq!(quarters.len(), 5);
    let land: f64 = phases[0].shapes.iter().map(g::area).sum();
    assert!((land - covered).abs() < 5.0, "{land} {covered}");
}

#[test]
fn polygonal_enclosure_is_filled_to_the_wall_and_frames_its_grid() {
    let (height, water) = (vec![10.; 100], vec![0u8; 100]);
    let surface = Surface { geometry: None, width: 1000., n: 10, height: &height, water: &water, interpolation: Default::default() };
    let at = |x: f64, y: f64| Point { x: 500. + x, y: 500. + y };
    let a = 20f64.to_radians();
    let turn = |x: f64, y: f64| at(x * a.cos() - y * a.sin(), x * a.sin() + y * a.cos());
    let square = |x0: f64, y0: f64, x1: f64, y1: f64| g::normalized(Shape {
        outer: vec![turn(x0, y0), turn(x1, y0), turn(x1, y1), turn(x0, y1)], holes: vec![] });
    // A 20° grid inside a hexagonal curtain: the belt between them is town land.
    let wall = g::normalized(Shape { outer: (0..6).map(|k| { let t = k as f64 * 60f64.to_radians();
        at(170. * t.cos(), 170. * t.sin()) }).collect(), holes: vec![] });
    assert!(!rectangular(&wall));
    let mut quarters: Vec<Quarter> = [(-100., -100.), (0., -100.), (-100., 0.), (0., 0.)].iter()
        .map(|&(x, y)| Quarter { shape: square(x, y, x + 100., y + 100.), phase: 0, zone: "core".into() }).collect();
    let outline = square(-100., -100., 100., 100.);
    let street = Street { path: vec![turn(-250., 100.), turn(250., 100.)], widths: vec![6.; 2], rank: 1, role: "street".into() };
    let mut phases = vec![GrowthPhase { culture: "chinese".into(), kind: "foundation".into(), zone: "core".into(), recipe: String::new(),
        population: 1000., target_area: 40_000., shapes: vec![outline] }];
    fill_enclosures(&mut quarters, &mut phases, std::slice::from_ref(&wall), 1, std::slice::from_ref(&street), surface);
    let covered: f64 = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>()).iter().map(g::area).sum();
    assert!(covered >= 0.97 * g::area(&wall), "{covered} of {}", g::area(&wall));
    assert_eq!(quarters.len(), 5);
    let land: f64 = phases[0].shapes.iter().map(g::area).sum();
    assert!((land - covered).abs() < 5.0, "{land} {covered}");
    // A curtain mostly on the compass whose tightest box runs on its one long
    // diagonal: the grid takes the curtain's axes, not the box's.
    let stairs = g::normalized(Shape { outer: [(0., 0.), (200., 0.), (500., 300.), (500., 500.), (300., 500.), (300., 400.),
        (200., 400.), (200., 300.), (100., 300.), (100., 200.), (0., 200.)].iter().map(|&(x, y)| at(x, y)).collect(), holes: vec![] });
    let off = |r: f64| { let d = r.to_degrees().rem_euclid(90.); d.min(90. - d) };
    assert!(off(super::quarters::outline_frame(&stairs)) > 40.);
    assert!(off(super::quarters::enclosure_frame(&stairs)) < 0.5, "{}", super::quarters::enclosure_frame(&stairs).to_degrees());
    // A rectangle keeps its box.
    let rect = square(-100., -50., 100., 50.);
    let d = super::quarters::enclosure_frame(&rect) - super::quarters::outline_frame(&rect);
    assert!(d.abs() < 1e-9, "{d}");
}
fn closed_shape(e: &Enclosure) -> Shape {
    let mut outer = e.path.clone();
    outer.pop();
    Shape { outer, holes: vec![] }
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
    let walls = fortification::trace_enclosures(walls, &plan.quarters.iter()
        .map(|q| q.shape.clone()).collect::<Vec<_>>(), surface);
    let walls = walls.into_iter().map(|s| fortification::parameter_trace(s, surface, cfg, culture, style.curtain_width)).collect::<Vec<_>>();
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
                    match fortification::attach(&o, &walls[0]) {
                        Some(e) => { attached = true; vec![o, e] }
                        None => {
                            plan.warnings.push("Enceinte accolée impossible sur ce contour, enceinte concentrique conservée.".into());
                            walls
                        }
                    }
                }
                _ => walls,
            }
        }
        None => {
            if extension == "attached" && walled >= 2 {
                plan.warnings.push("Enceinte accolée impossible sur ce contour, enceinte concentrique conservée.".into());
            }
            walls
        }
    };
    // A knoll in or at the rim of the town carries its castle, in its own
    // contour circuit; the town wall runs round it where it stands astride.
    let occupied: Vec<Shape> = plan.quarters.iter().map(|q| q.shape.clone()).collect();
    let castle = fortification::heights_castle(&walls, &occupied, &plan.streets, surface, cfg, culture, site.population, &base);
    let walls = match &castle { Some(c) => fortification::wrap_castle(walls, c), None => walls };
    style.options(cfg);
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
    // A large planned capital keeps one circuit per epoch (palace/inner/outer city).
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
            inner_walls.extend(old.into_iter().map(|s| fortification::parameter_trace(s, surface, cfg, culture, inner_style.curtain_width)));
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
    }
    // A town's enceinte, square or polygonal, is filled to its wall street (the
    // castle keeps its own ward); a small settlement fills a square circuit and
    // fits its quarters to any other.
    if small {
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
    let first = plan.enclosures.len();
    let outer = walls.len();
    // Gate passages and causeways are cut at the width the street hierarchy
    // gives these streets later (through routes become arterial gate streets).
    let rank_base: [f64; 5] = std::array::from_fn(|r| {
        morph.value["widthByRank"][r].as_f64().unwrap_or(3.0) * morph.number_or("widthScale", 1.0)
    });
    let table = super::network::rank_widths(rank_base, site.population, cfg.road_width_by_size);
    let predicted = fortification::Predicted {
        widths: table.map(|w| w * 1.1),
        arterial: if site.population >= 20_000 { 0 } else { 1 },
        dwelling: super::culture::mapping_for(culture, &cfg.programme.period).map_or([5.0, 5.0], |m| {
            [m.admissibility.min_frontage, m.admissibility.min_depth]
        }),
    };
    let castle_at = walls.len() + inner_walls.len();
    for (i, wall) in walls.iter().chain(&inner_walls).chain(castle.iter()).enumerate() {
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
            purpose: if i >= castle_at { "castle".into() } else if citadel && i >= outer { "citadel".into() } else { String::new() },
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
        plan.enclosures.push(enclosure);
    }
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
