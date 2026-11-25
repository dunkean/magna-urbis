//! Settlement composition, before quarter and block subdivision. Cultural phase
//! thresholds, population shares and road ribbons follow the TypeScript planner.
use crate::urban::warnings;
use super::{
    Enclosure, GrowthPhase, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    UrbanCenter, UrbanEvent, catalogue, footprint, fortification, geometry as g, kinds::Kind,
    macroplan, profiles, resolve, routing,
};
#[path = "composition_faubourgs.rs"]
mod faubourgs;
pub(super) use faubourgs::{prepare_gate_villages, gate_service_cost, gate_demands, gate_morph, gate_activity, gate_pressures};
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
        plan.warnings.push(warnings::clustered_street_village());
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
            plan.warnings.push(warnings::no_suburbs());
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

mod modern;
use modern::generate_modern;
mod curtains;
pub(super) use curtains::{closing, water_gates, harbour_fronts, join_side_by_side, gates};
use curtains::{closed, fortify};
#[cfg(test)]
use curtains::closed_shape;
mod built_circuits;
#[cfg(test)]
use built_circuits::{VOID_SHARE, VOID_MIN, may_hold_void};
pub(super) use built_circuits::{enclosed_open, fit_enclosures, fit_built_circuits};
#[cfg(test)]
mod built_fit_tests;
#[cfg(test)]
mod side_by_side_tests;
#[cfg(test)]
mod wall_density_tests;
mod enclosed_quarters;
use enclosed_quarters::{partition, fit_enclosed_quarters, rectangular, grid_frame, fill_enclosures};
