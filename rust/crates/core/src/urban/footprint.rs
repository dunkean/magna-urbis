//! Budgeted urban footprints, independent of districts, streets and buildings.
//!
//! Planned foundations are vector templates; network accretion uses road bands;
//! accessible growth uses an anisotropic multi-source arrival field. The latter
//! is a bounded local raster (at most 192² cells), not a regional simulation.
//! All mechanisms preserve every dry component and interior exclusion.
use super::{
    LayoutConfig, Morph, Point, Shape, Site, Street, Surface, UrbanCenter, UrbanEvent,
    UrbanMetrics, UrbanStructure, geometry as g, macroplan, profiles, routing,
};
use crate::rng::Rng;
use geo::algorithm::bool_ops::unary_union;
use geo::{LineString, Simplify, Validation};
use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::f64::consts::{PI, TAU};

pub(in crate::urban) mod capacity;
mod crossings;
mod sparse;

pub(super) struct Footprint {
    pub structure: UrbanStructure,
    /// Chronological, disjoint attributed land. Earlier boundaries survive.
    pub phases: Vec<Vec<Shape>>,
    pub radius: f64,
    pub warnings: Vec<String>,
    /// Intended corridors are routed by the armature stage before acceptance.
    pub guides: Vec<Street>,
    /// Validated access through open land; never counted as an occupied ribbon.
    pub links: Vec<Street>,
}

fn distance(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
pub(super) fn union(shapes: &[Shape]) -> Vec<Shape> {
    if shapes.is_empty() {
        return vec![];
    }
    g::shapes(unary_union(
        &shapes.iter().map(g::polygon).collect::<Vec<_>>(),
    ))
}
fn area(shapes: &[Shape]) -> f64 {
    shapes.iter().map(g::area).sum()
}
fn dry(surface: Surface<'_>, shapes: &[Shape]) -> Vec<Shape> {
    union(
        &shapes
            .iter()
            .flat_map(|s| g::dry_clip(&surface, s))
            .collect::<Vec<_>>(),
    )
}
fn subtract(shapes: &[Shape], excluded: &[Shape]) -> Vec<Shape> {
    let mut result = shapes.to_vec();
    for s in excluded {
        result = result.iter().flat_map(|p| g::difference(p, s)).collect();
    }
    result
}
fn rotate(p: Point, angle: f64) -> Point {
    Point {
        x: p.x * angle.cos() - p.y * angle.sin(),
        y: p.x * angle.sin() + p.y * angle.cos(),
    }
}
fn at(center: Point, p: Point, angle: f64) -> Point {
    let p = rotate(p, angle);
    Point {
        x: center.x + p.x,
        y: center.y + p.y,
    }
}

fn guides(family: &str, center: Point, radius: f64, angle: f64, rng: &Rng) -> Vec<Street> {
    let mut paths = vec![];
    if family == "fingers" {
        for i in 0..5 {
            let a = angle + i as f64 * TAU / 5.0;
            let twist = rng.fork(&format!("finger:{i}")).range(-0.18, 0.18);
            paths.push(vec![
                center,
                at(
                    center,
                    Point {
                        x: radius * 0.7,
                        y: 0.0,
                    },
                    a,
                ),
                at(
                    center,
                    Point {
                        x: radius * 1.75,
                        y: radius * twist,
                    },
                    a,
                ),
            ]);
        }
    } else if family == "dendritic" {
        // A trunk with staggered, recursively split branches has a different
        // accessibility field from a star of radial approach corridors.
        paths.push(vec![
            at(
                center,
                Point {
                    x: -radius * 0.7,
                    y: 0.0,
                },
                angle,
            ),
            center,
            at(
                center,
                Point {
                    x: radius * 1.45,
                    y: 0.0,
                },
                angle,
            ),
        ]);
        for i in 0..3 {
            let x = radius * (-0.35 + i as f64 * 0.57);
            let side = if i % 2 == 0 { 1.0 } else { -1.0 };
            let fork = Point {
                x: x + radius * 0.18,
                y: radius * 0.46 * side,
            };
            let anchor = Point { x, y: 0.0 };
            paths.push(vec![
                at(center, anchor, angle),
                at(center, fork, angle),
                at(
                    center,
                    Point {
                        x: fork.x + radius * 0.38,
                        y: radius * 1.02 * side,
                    },
                    angle,
                ),
            ]);
            paths.push(vec![
                at(center, fork, angle),
                at(
                    center,
                    Point {
                        x: fork.x - radius * 0.52,
                        y: radius * 0.78 * side,
                    },
                    angle,
                ),
            ]);
        }
    }
    paths
        .into_iter()
        .map(|path| Street {
            widths: vec![5.0; path.len()],
            path,
            rank: 1,
            role: "street".into(),
        })
        .collect()
}

/// Zone and recipe of one growth epoch: the founding core, its first extension,
/// then the periphery. Villages keep a single village tissue.
pub(super) fn epoch_zone(
    cfg: &LayoutConfig,
    population: u32,
    epoch: usize,
) -> (&str, &'static str) {
    let small = population < 1200;
    let zone = if cfg.zone != "auto" {
        cfg.zone.as_str()
    } else if small {
        "village"
    } else {
        ["core", "middle", "edge"][epoch.min(2)]
    };
    let recipe = if small {
        "village"
    } else if epoch == 0 {
        "core"
    } else {
        "ring"
    };
    (zone, recipe)
}
/// Gross inhabitants/hectare of each growth epoch, streets and reservations
/// included. Each epoch reads its own catalogue density (core > middle > edge),
/// so the old centre packs more people on less land than the periphery. Larger
/// cities densify their historic core further (Paris 1300, Fez, Chang'an), up to
/// a bounded 1.5x. An explicit gross density stays uniform, as before.
pub(super) fn epoch_densities(site: &Site, cfg: &LayoutConfig, morph: &Morph) -> Vec<f64> {
    let epochs = cfg.footprint.epochs.max(1);
    if cfg.footprint.gross_density > 0.0 {
        return vec![cfg.footprint.gross_density; epochs];
    }
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let boost = (1.0 + 0.25 * (site.population as f64 / 5000.0).max(1.0).log10()).min(1.5);
    (0..epochs)
        .map(|epoch| {
            let (zone, name) = epoch_zone(cfg, site.population, epoch);
            let recipe = super::composition::recipe(culture, site.population, name);
            let local = super::composition::phase_morph(
                culture,
                &recipe,
                zone,
                &cfg.preset,
                &cfg.recipe,
                cfg.density,
                &cfg.params,
                "quarters",
            )
            .unwrap_or_else(|_| morph.clone());
            let base = local.value["density"][zone]
                .as_f64()
                .or_else(|| morph.value["density"][zone].as_f64())
                .unwrap_or(60.0);
            let lift = match epoch {
                0 => boost,
                1 => 1.0 + (boost - 1.0) * 0.5,
                _ => 1.0,
            };
            (base * cfg.density * lift).clamp(5.0, 600.0)
        })
        .collect()
}
/// Cumulative land fractions of the epochs. Every epoch houses an equal share of
/// the population, so a denser epoch receives proportionally less land.
pub(super) fn epoch_fractions(densities: &[f64]) -> Vec<f64> {
    let total: f64 = densities.iter().map(|d| 1.0 / d.max(0.001)).sum();
    let mut cumulative = 0.0;
    densities
        .iter()
        .map(|d| {
            cumulative += 1.0 / d.max(0.001) / total;
            cumulative.min(1.0)
        })
        .collect()
}
/// Zone, recipe and land share of each growth epoch, for the capacity plan.
fn capacity_epochs(
    site: &Site,
    cfg: &LayoutConfig,
    morph: &Morph,
    area: f64,
    surface: Surface<'_>,
) -> Vec<capacity::Epoch> {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let fractions = epoch_fractions(&epoch_densities(site, cfg, morph));
    // The land the footprint will take: growth (`grow`) never enters ground
    // steeper than the buildable grade and prices a cell by its distance times
    // its terrain cost, so of the dry, buildable samples within reach the
    // cheapest ones, as many as the footprint area holds, stand for it.
    let radius = (area / PI).sqrt();
    let step = radius / 6.0;
    let grade_limit = buildable_grade(site, cfg);
    let relief = 0.35 + cfg.footprint.anisotropy * 0.65;
    let wanted = (-6..=6_i32)
        .flat_map(|y| (-6..=6_i32).map(move |x| x * x + y * y))
        .filter(|&r| r <= 36)
        .count();
    let mut cells: Vec<(f64, f64)> = (-11..=11_i32)
        .flat_map(|y| (-11..=11_i32).map(move |x| (x, y)))
        .filter(|(x, y)| x * x + y * y <= 121)
        .filter_map(|(x, y)| {
            let p = Point {
                x: site.center.x + f64::from(x) * step,
                y: site.center.y + f64::from(y) * step,
            };
            if surface.wet(p) {
                return None;
            }
            let (gx, gy) = slope(surface, p);
            let grade = gx.hypot(gy);
            (grade <= grade_limit).then(|| {
                let terrain = 1.0 + relief * (grade * 2.5 + (grade / grade_limit).powi(2) * 4.0);
                (f64::from(x).hypot(f64::from(y)) * terrain, grade)
            })
        })
        .collect();
    cells.sort_by(|a, b| a.0.total_cmp(&b.0));
    cells.truncate(wanted);
    // A block's slope is its steepest rim over its centroid: about 1.3 times
    // the ground gradient. Blocks steeper than the houses admit hold none.
    let slopes: Vec<f64> = {
        let mut v: Vec<f64> = cells.iter().map(|c| 1.3 * c.1).collect();
        v.sort_by(f64::total_cmp);
        v
    };
    // Blocks on a slope have less access pressure (`programme::prepare`
    // divides it by 1 + 3 × slope): the median slope of that land.
    let median = slopes.get(slopes.len() / 2).copied().unwrap_or(0.0);
    let max_slope = super::culture::mapping_for(culture, &cfg.programme.period)
        .map_or(0.15, |m| m.admissibility.max_slope);
    let steep =
        slopes.iter().filter(|&&s| s > max_slope).count() as f64 / slopes.len().max(1) as f64;
    let access: Vec<(f64, f64)> = capacity::epoch_access(&fractions, area)
        .into_iter()
        .map(|(p, r)| (p / (1.0 + 3.0 * median), r))
        .collect();
    let mut previous = 0.0;
    fractions
        .iter()
        .zip(access)
        .enumerate()
        .map(|(epoch, (&f, (pressure, offset)))| {
            let (zone, name) = epoch_zone(cfg, site.population, epoch);
            let share = f - previous;
            previous = f;
            capacity::Epoch {
                zone: zone.to_owned(),
                recipe: super::composition::recipe(culture, site.population, name),
                share,
                pressure,
                offset,
                steep,
                fields: if cfg.placement == "center" {
                    capacity::fringe_fields(previous - share, previous)
                } else {
                    0.0
                },
            }
        })
        .collect()
}
fn budget(site: &Site, cfg: &LayoutConfig, morph: &Morph, radius: f64) -> (f64, f64) {
    // Equal population per epoch: the overall gross density is their harmonic mean.
    let densities = epoch_densities(site, cfg, morph);
    let density = (densities.len() as f64
        / densities.iter().map(|d| 1.0 / d.max(0.001)).sum::<f64>())
    .max(0.001);
    let target = if cfg.footprint.budget == "radius" {
        PI * radius * radius
    } else {
        site.population as f64 / density * 10_000.0
    };
    let target = target.max(1.0);
    let density = if cfg.footprint.budget == "radius" {
        site.population as f64 * 10_000.0 / target
    } else {
        density
    };
    (target, density)
}
#[derive(Clone, Copy)]
struct Geography {
    dry_fraction: f64,
    buildable_fraction: f64,
    slope_p90: f64,
    relief: f64,
    contour_angle: f64,
}
fn slope(surface: Surface<'_>, p: Point) -> (f64, f64) {
    let d = (surface.width / surface.n as f64 * 0.45).max(1.0);
    (
        (surface.height_at(Point { x: p.x + d, y: p.y })
            - surface.height_at(Point { x: p.x - d, y: p.y }))
            / (2.0 * d),
        (surface.height_at(Point { x: p.x, y: p.y + d })
            - surface.height_at(Point { x: p.x, y: p.y - d }))
            / (2.0 * d),
    )
}
fn buildable_grade(site: &Site, cfg: &LayoutConfig) -> f64 {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let profile = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
    if profile.stairs || profile.pattern == "terraces" {
        0.5
    } else {
        0.34
    }
}
/// A footprint-scale survey catches a hilltop/col whose center gradient is zero.
/// Densities and foundation decisions use the same final physical terrain.
fn geography(site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, radius: f64) -> Geography {
    let mut slopes = vec![];
    let mut heights = vec![];
    let (mut total, mut buildable) = (0, 0);
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    let grade_limit = buildable_grade(site, cfg);
    for y in -10..=10 {
        for x in -10..=10 {
            if x * x + y * y > 100 {
                continue;
            }
            total += 1;
            let p = Point {
                x: site.center.x + x as f64 * radius * 1.45 / 10.0,
                y: site.center.y + y as f64 * radius * 1.45 / 10.0,
            };
            if surface.wet(p) {
                continue;
            }
            let (gx, gy) = slope(surface, p);
            let s = gx.hypot(gy);
            slopes.push(s);
            heights.push(surface.height_at(p));
            buildable += usize::from(s <= grade_limit);
            xx += gx * gx;
            xy += gx * gy;
            yy += gy * gy;
        }
    }
    slopes.sort_by(f64::total_cmp);
    heights.sort_by(f64::total_cmp);
    let quantile = |values: &[f64], q: f64| {
        values
            .get((values.len().saturating_sub(1) as f64 * q) as usize)
            .copied()
            .unwrap_or(0.0)
    };
    Geography {
        dry_fraction: slopes.len() as f64 / total.max(1) as f64,
        buildable_fraction: buildable as f64 / total.max(1) as f64,
        slope_p90: quantile(&slopes, 0.9),
        relief: quantile(&heights, 0.9) - quantile(&heights, 0.1),
        contour_angle: 0.5 * (2.0 * xy).atan2(xx - yy) + PI * 0.5,
    }
}
fn geometric_foundation(site: &Site, cfg: &LayoutConfig) -> bool {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let profile = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
    profile.pattern == "grid"
        && profiles::fortification(profile, &cfg.fortification, site.population) != "none"
        && matches!(profile.enclosure, "rect" | "square" | "rounded-rect")
        || profile.pattern == "radial"
            && profile.enclosure == "circle"
            && matches!(culture.as_str(), "norse-ringfort" | "wizard-city")
}
fn compatible_foundation(geography: Geography, radius: f64) -> bool {
    geography.dry_fraction >= 0.88
        && geography.buildable_fraction >= 0.88
        && geography.slope_p90 <= 0.10
        && geography.relief <= radius * 0.18
}
fn family<'a>(site: &Site, cfg: &'a LayoutConfig, geography: Geography, radius: f64) -> &'a str {
    if cfg.footprint.family != "auto" {
        return &cfg.footprint.family;
    }
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let p = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
    if p.enclosure == "square"
        && p.pattern == "grid"
        && profiles::fortification(p, &cfg.fortification, site.population) != "none"
    {
        "rectangle"
    } else if p.pattern == "linear" {
        "linear"
    } else if geometric_foundation(site, cfg) && compatible_foundation(geography, radius) {
        if p.enclosure == "circle" {
            "circle"
        } else {
            "rectangle"
        }
    } else if p.pattern == "dispersed" {
        "archipelago"
    } else if p.pattern == "terraces"
        || geography.slope_p90 > 0.14 && geography.relief > radius * 0.18
    {
        "elongated"
    } else {
        "compact"
    }
}
fn mechanism<'a>(cfg: &'a LayoutConfig, family: &str) -> &'a str {
    if family == "rectangle" {
        return "planned";
    }
    if cfg.footprint.mechanism != "auto" {
        return &cfg.footprint.mechanism;
    }
    match family {
        "circle" | "rectangle" | "polygon" => "planned",
        "linear" => "ribbon",
        "lobed" | "archipelago" => "fusion",
        _ => "accessibility",
    }
}
fn orientation(site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, roads: &[Street]) -> f64 {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let p = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
    let mut angle = roads
        .iter()
        .flat_map(|s| s.path.windows(2))
        .map(|w| {
            (
                g::distance(site.center, w[0], w[1]).0,
                (w[1].y - w[0].y).atan2(w[1].x - w[0].x),
            )
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|v| v.1)
        .unwrap_or(0.0);
    if p.orientation == "cardinal" {
        angle = 0.0;
    }
    if p.orientation == "terrain" {
        let step = (surface.width / surface.n as f64).max(5.0);
        let c = site.center;
        let gx = surface.height_at(Point {
            x: c.x + step,
            y: c.y,
        }) - surface.height_at(Point {
            x: c.x - step,
            y: c.y,
        });
        let gy = surface.height_at(Point {
            x: c.x,
            y: c.y + step,
        }) - surface.height_at(Point {
            x: c.x,
            y: c.y - step,
        });
        if gx.hypot(gy) > 0.1 {
            angle = gy.atan2(gx) + PI * 0.5;
        }
    }
    if cfg.axis_alignment == "regional"
        && cfg.params.get("orientation").is_none()
        && cfg.preset == "culture"
        && let Some(regional) = super::macroplan::regional_axis(
            site.center,
            site.radius * cfg.radius_scale * 1.5,
            roads,
        )
    {
        angle = regional;
    }
    angle + cfg.footprint.orientation.to_radians()
}

/// Snap only onto existing dry terrain. No dry candidate means the nucleus is
/// omitted and the resulting budget deficit remains explicit.
fn dry_center(p: Point, radius: f64, surface: Surface<'_>) -> Option<Point> {
    let p = Point {
        x: p.x.clamp(0.01, surface.width - 0.01),
        y: p.y.clamp(0.01, surface.width - 0.01),
    };
    if !surface.wet(p) {
        return Some(p);
    }
    let cell = surface.width / surface.n as f64;
    let reach = (radius * 0.65).max(cell * 2.0);
    let ix = (p.x / cell) as isize;
    let iy = (p.y / cell) as isize;
    let count = (reach / cell).ceil().min(32.0) as isize;
    let mut best = None;
    let mut cost = f64::INFINITY;
    for dy in -count..=count {
        for dx in -count..=count {
            let x = ix + dx;
            let y = iy + dy;
            if x < 0
                || y < 0
                || x >= surface.n as isize
                || y >= surface.n as isize
                || surface.water[y as usize * surface.n + x as usize] != 0
            {
                continue;
            }
            let q = Point {
                x: (x as f64 + 0.5) * cell,
                y: (y as f64 + 0.5) * cell,
            };
            let d = distance(p, q);
            if d < cost {
                best = Some(q);
                cost = d;
            }
        }
    }
    best
}
#[allow(clippy::too_many_arguments)]
fn centers(
    site: &Site,
    cfg: &LayoutConfig,
    family: &str,
    mechanism: &str,
    radius: f64,
    angle: f64,
    surface: Surface<'_>,
    rng: &Rng,
) -> Vec<UrbanCenter> {
    let count = if family == "composite" {
        2
    } else if mechanism == "fusion" || matches!(family, "lobed" | "archipelago") {
        cfg.footprint.nuclei
    } else {
        1
    };
    let mut result: Vec<UrbanCenter> = vec![];
    for i in 0..count {
        let p = if i == 0 {
            site.center
        } else {
            let bearing = if family == "composite" {
                angle
            } else {
                angle
                    + (i - 1) as f64 * TAU / (count - 1).max(1) as f64
                    + rng.fork(&format!("center:{i}")).range(-0.17, 0.17)
            };
            let d = radius
                * cfg.footprint.separation
                * if family == "archipelago" {
                    1.05
                } else if family == "composite" {
                    0.72
                } else {
                    0.7
                };
            Point {
                x: site.center.x + d * bearing.cos(),
                y: site.center.y + d * bearing.sin(),
            }
        };
        if let Some(p) = dry_center(p, radius, surface)
            && result.iter().all(|c| distance(p, c.point) > radius * 0.12)
        {
            result.push(UrbanCenter {
                id: result.len(),
                point: p,
                weight: if i == 0 { 1.3 } else { 1.0 },
            });
        }
    }
    let total: f64 = result.iter().map(|c| c.weight).sum();
    for c in &mut result {
        c.weight /= total;
    }
    result
}

fn template(
    center: Point,
    family: &str,
    radius: f64,
    aspect: f64,
    angle: f64,
    irregularity: f64,
    phase: f64,
) -> Shape {
    let (rx, ry) = (radius * aspect.sqrt(), radius / aspect.sqrt());
    let outer = if family == "rectangle" {
        [(-rx, -ry), (rx, -ry), (rx, ry), (-rx, ry)]
            .into_iter()
            .map(|(x, y)| at(center, Point { x, y }, angle))
            .collect()
    } else {
        let n = if family == "polygon" { 7 } else { 64 };
        (0..n)
            .map(|i| {
                let a = i as f64 * TAU / n as f64;
                let noise = if matches!(family, "circle" | "polygon") {
                    1.0
                } else {
                    1.0 + irregularity
                        * (0.16 * (3.0 * a + phase).sin() + 0.09 * (5.0 * a - phase).cos())
                };
                at(
                    center,
                    Point {
                        x: rx * a.cos() * noise,
                        y: ry * a.sin() * noise,
                    },
                    angle,
                )
            })
            .collect()
    };
    g::normalized(Shape {
        outer,
        holes: vec![],
    })
}
fn scale(s: &Shape, center: Point, factor: f64) -> Shape {
    let ring = |r: &[Point]| {
        r.iter()
            .map(|p| Point {
                x: center.x + (p.x - center.x) * factor,
                y: center.y + (p.y - center.y) * factor,
            })
            .collect()
    };
    Shape {
        outer: ring(&s.outer),
        holes: s.holes.iter().map(|r| ring(r)).collect(),
    }
}

/// Independent nucleus budgets are calibrated on the vector union. This avoids
/// counting the overlap between nuclei twice while allowing disconnected land.
#[allow(clippy::too_many_arguments)]
fn planned(
    target: f64,
    family: &str,
    cfg: &LayoutConfig,
    centers: &[UrbanCenter],
    angle: f64,
    fractions: &[f64],
    surface: Surface<'_>,
    rng: &Rng,
) -> (Vec<Shape>, Vec<Vec<Shape>>) {
    let epochs = fractions.len();
    let templates: Vec<_> = centers
        .iter()
        .map(|c| {
            let local_family = if family == "composite" {
                if c.id == 0 { "compact" } else { "rectangle" }
            } else if matches!(family, "lobed" | "archipelago") {
                "compact"
            } else {
                family
            };
            let a = if family == "composite" && c.id > 0 {
                angle + PI * 0.18
            } else {
                angle
            };
            let aspect = if matches!(family, "lobed" | "archipelago") {
                1.15
            } else {
                cfg.footprint.aspect
            };
            let shape = template(
                c.point,
                local_family,
                (target * c.weight / PI).sqrt(),
                aspect,
                a,
                cfg.footprint.irregularity,
                rng.fork(&format!("outline:{}", c.id)).range(0.0, TAU),
            );
            let factor = (target * c.weight / g::area(&shape)).sqrt();
            scale(&shape, c.point, factor)
        })
        .collect();
    let build = |factor: f64| {
        union(
            &templates
                .iter()
                .zip(centers)
                .map(|(s, c)| scale(s, c.point, factor))
                .collect::<Vec<_>>(),
        )
    };
    let (mut lo, mut hi) = (1.0, 2.5);
    for _ in 0..14 {
        let mid = (lo + hi) * 0.5;
        if area(&build(mid)) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let factor = (lo + hi) * 0.5;
    let reserve = build(factor * 1.2);
    let mut cumulative: Vec<Shape> = vec![];
    let mut phases = vec![];
    for (epoch, &fraction) in fractions.iter().enumerate() {
        let outlines = templates
            .iter()
            .zip(centers)
            .filter_map(|(s, c)| {
                // A composite extension is founded after the inherited first core.
                if family == "composite" && c.id > 0 && epoch == 0 && epochs > 1 {
                    return None;
                }
                Some(scale(s, c.point, factor * fraction.sqrt()))
            })
            .collect::<Vec<_>>();
        let grown = union(&[cumulative.clone(), dry(surface, &union(&outlines))].concat());
        phases.push(subtract(&grown, &cumulative));
        cumulative = grown;
    }
    (reserve, phases)
}

#[derive(Clone, Copy)]
struct Arrival {
    cost: f64,
    cell: usize,
}
impl PartialEq for Arrival {
    fn eq(&self, other: &Self) -> bool {
        self.cost == other.cost && self.cell == other.cell
    }
}
impl Eq for Arrival {}
impl PartialOrd for Arrival {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Arrival {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| other.cell.cmp(&self.cell))
    }
}

struct Grid {
    x0: f64,
    y0: f64,
    step: f64,
    nx: usize,
    ny: usize,
}
impl Grid {
    fn point(&self, i: usize) -> Point {
        Point {
            x: self.x0 + (i % self.nx) as f64 * self.step + self.step * 0.5,
            y: self.y0 + (i / self.nx) as f64 * self.step + self.step * 0.5,
        }
    }
    fn nearest(&self, p: Point) -> usize {
        let x = ((p.x - self.x0) / self.step)
            .floor()
            .clamp(0.0, (self.nx - 1) as f64) as usize;
        let y = ((p.y - self.y0) / self.step)
            .floor()
            .clamp(0.0, (self.ny - 1) as f64) as usize;
        y * self.nx + x
    }
    fn move_cells(&self, from: usize, to: usize, costs: &[f64]) -> Vec<usize> {
        let (a, b) = (self.point(from), self.point(to));
        let steps = ((from % self.nx)
            .abs_diff(to % self.nx)
            .max((from / self.nx).abs_diff(to / self.nx))
            * 4)
        .max(4);
        let mut cells = vec![from];
        for j in 0..steps {
            let t = (j as f64 + 0.5) / steps as f64;
            let i = self.nearest(Point {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            });
            let previous = *cells.last().unwrap();
            if i == previous {
                continue;
            }
            if (i % self.nx).abs_diff(previous % self.nx) == 1
                && (i / self.nx).abs_diff(previous / self.nx) == 1
            {
                let left = previous / self.nx * self.nx + i % self.nx;
                let right = i / self.nx * self.nx + previous % self.nx;
                cells.push(if costs[left] <= costs[right] {
                    left
                } else {
                    right
                });
            }
            cells.push(i);
        }
        cells
    }
    /// Union run-length rectangles, retaining all holes and components. Collinear
    /// vertices are removed exactly; no contour simplification fills exclusions.
    fn contours(&self, mask: &[bool]) -> Vec<Shape> {
        let mut runs = vec![];
        for y in 0..self.ny {
            let mut x = 0;
            while x < self.nx {
                if !mask[y * self.nx + x] {
                    x += 1;
                    continue;
                }
                let start = x;
                while x < self.nx && mask[y * self.nx + x] {
                    x += 1;
                }
                runs.push(g::rectangle(
                    self.x0 + start as f64 * self.step,
                    self.y0 + y as f64 * self.step,
                    self.x0 + x as f64 * self.step,
                    self.y0 + (y + 1) as f64 * self.step,
                ));
            }
        }
        union(&runs)
    }

    fn boundary_centers(&self, mask: &[bool]) -> Vec<Point> {
        mask.iter()
            .enumerate()
            .filter_map(|(i, &selected)| {
                if !selected {
                    return None;
                }
                let (x, y) = (i % self.nx, i / self.nx);
                let boundary = x == 0
                    || y == 0
                    || x + 1 == self.nx
                    || y + 1 == self.ny
                    || !mask[i - 1]
                    || !mask[i + 1]
                    || !mask[i - self.nx]
                    || !mask[i + self.nx];
                boundary.then(|| self.point(i))
            })
            .collect()
    }
}

/// Remove the growth lattice's right-angle staircase without reconstructing a
/// shoreline. Water holes remain frozen and the result is re-clipped against the
/// original terrain mask. Every narrow-arm boundary cell retains its center.
/// Invalid or materially different candidates keep the exact original contour.
fn smooth_growth(
    shapes: &[Shape],
    step: f64,
    surface: Surface<'_>,
    anchors: &[Point],
) -> Vec<Shape> {
    fn ring(points: &[Point], step: f64) -> Vec<Point> {
        // Collapse complete lattice steps before rounding. Rounding each raw
        // right angle alone preserves the staircase at every zoom level.
        let mut closed: Vec<_> = points
            .iter()
            .map(|p| geo::Coord { x: p.x, y: p.y })
            .collect();
        if let Some(p) = closed.first().copied() {
            closed.push(p);
        }
        let simplified = LineString(closed).simplify(step * 0.55);
        let mut outline: Vec<_> = simplified
            .0
            .into_iter()
            .map(|p| Point { x: p.x, y: p.y })
            .collect();
        outline.pop();
        if outline.len() < 3 {
            return points.to_vec();
        }
        // Sample by physical distance so long sides and dense raster corners
        // receive the same smoothing, without shrinking narrow branches.
        let mut points: Vec<_> = outline
            .iter()
            .zip(outline.iter().cycle().skip(1))
            .take(outline.len())
            .flat_map(|(&a, &b)| {
                let n = (distance(a, b) / step).ceil().max(1.0) as usize;
                (0..n).map(move |i| {
                    let t = i as f64 / n as f64;
                    Point {
                        x: a.x * (1.0 - t) + b.x * t,
                        y: a.y * (1.0 - t) + b.y * t,
                    }
                })
            })
            .collect();
        // Attenuate residual one-cell undulations over several cells before
        // fitting the corners. Keep displacement below half a cell so thin
        // arms retain their supporting cell centers.
        let sampled = points.clone();
        for _ in 0..3 {
            points = (0..points.len())
                .map(|i| {
                    let mut p = Point { x: 0.0, y: 0.0 };
                    for (j, weight) in [1.0, 4.0, 6.0, 4.0, 1.0].into_iter().enumerate() {
                        let q = points[(i + points.len() + j - 2) % points.len()];
                        p.x += q.x * weight / 16.0;
                        p.y += q.y * weight / 16.0;
                    }
                    let a = sampled[i];
                    let t = (step * 0.45 / distance(a, p).max(1.0e-9)).min(1.0);
                    Point {
                        x: a.x + (p.x - a.x) * t,
                        y: a.y + (p.y - a.y) * t,
                    }
                })
                .collect();
        }
        for _ in 0..3 {
            points = points
                .iter()
                .zip(points.iter().cycle().skip(1))
                .take(points.len())
                .flat_map(|(&a, &b)| {
                    let t = 0.25;
                    [
                        Point {
                            x: a.x * (1.0 - t) + b.x * t,
                            y: a.y * (1.0 - t) + b.y * t,
                        },
                        Point {
                            x: a.x * t + b.x * (1.0 - t),
                            y: a.y * t + b.y * (1.0 - t),
                        },
                    ]
                })
                .collect();
        }
        let mut closed: Vec<_> = points
            .iter()
            .map(|p| geo::Coord { x: p.x, y: p.y })
            .collect();
        if let Some(p) = closed.first().copied() {
            closed.push(p);
        }
        let simplified = LineString(closed).simplify(step * 0.025);
        let mut result: Vec<_> = simplified
            .0
            .into_iter()
            .map(|p| Point { x: p.x, y: p.y })
            .collect();
        if result.len() > 1 {
            result.pop();
        }
        result
    }
    // Open-space holes left by the lattice are smoothed like the outline; exact
    // water holes (clipped from vector geography) are never axis-aligned and stay.
    let lattice = |ring: &[Point]| {
        ring.iter()
            .zip(ring.iter().cycle().skip(1))
            .all(|(a, b)| (a.x - b.x).abs() < 1e-6 || (a.y - b.y).abs() < 1e-6)
    };
    let mut candidates = vec![];
    for original in shapes {
        let outline = g::normalized(Shape {
            outer: ring(&original.outer, step),
            holes: original
                .holes
                .iter()
                .map(|h| if lattice(h) { ring(h, step) } else { h.clone() })
                .collect(),
        });
        if outline.outer.len() < 3 || !g::polygon(&outline).is_valid() {
            candidates.push(original.clone());
            continue;
        }
        let mut clipped = g::dry_clip(&surface, &outline);
        if clipped.len() != 1
            || clipped[0].holes.len() != original.holes.len()
            || !g::polygon(&clipped[0]).is_valid()
        {
            candidates.push(original.clone());
            continue;
        }
        // Preserve an isolated boundary cell locally instead of restoring the
        // staircase of the entire district when one smoothing corner clips it.
        let mut repaired = clipped[0].clone();
        let mut moved = false;
        for &p in anchors.iter().filter(|&&p| g::contains(original, p)) {
            if g::contains(&repaired, p) {
                continue;
            }
            let closest = repaired
                .outer
                .iter()
                .enumerate()
                .map(|(i, &a)| {
                    let (d, t, q) =
                        g::distance(p, a, repaired.outer[(i + 1) % repaired.outer.len()]);
                    (i, d, t, q)
                })
                .min_by(|a, b| a.1.total_cmp(&b.1));
            let Some((i, d, t, q)) = closest else {
                continue;
            };
            if d <= 1.0e-9 || d > step * 0.45 {
                continue;
            }
            moved = true;
            if t > 1.0e-6 && t < 1.0 - 1.0e-6 {
                repaired.outer.insert(i + 1, q);
            }
            let shift = (d + step * 0.02) / d;
            for v in &mut repaired.outer {
                let weight = (1.0 - distance(*v, q) / (step * 2.0)).max(0.0).powi(2);
                v.x += (p.x - q.x) * shift * weight;
                v.y += (p.y - q.y) * shift * weight;
            }
        }
        if moved && g::polygon(&repaired).is_valid() {
            let next = g::dry_clip(&surface, &repaired);
            if next.len() == 1
                && next[0].holes.len() == original.holes.len()
                && g::polygon(&next[0]).is_valid()
            {
                clipped = next;
            }
        }
        // Rounding (and the anchor repair) can shift the area by a few percent
        // and restore the whole lattice contour. Recover it with a bounded
        // correction of the outer ring; water holes stay fixed and are clipped
        // again before the same topology, displacement and anchor checks.
        if (g::area(&clipped[0]) - g::area(original)).abs() > g::area(original) * 0.005 {
            // Uniform offset of the outer ring along its normals by the area
            // difference over the perimeter (smoothed open-space holes also
            // change the area, which a scale about the centre cannot absorb).
            let ring = &clipped[0].outer;
            let length: f64 = ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .map(|(&a, &b)| distance(a, b))
                .sum();
            let offset = (g::area(original) - g::area(&clipped[0])) / length.max(1e-9);
            let sign = g::signed(ring).signum();
            let normal = |a: Point, b: Point| {
                let l = distance(a, b).max(1e-9);
                Point {
                    x: sign * (b.y - a.y) / l,
                    y: -sign * (b.x - a.x) / l,
                }
            };
            let n = ring.len();
            let mut adjusted = clipped[0].clone();
            for i in 0..n {
                let (a, b) = (
                    normal(ring[(i + n - 1) % n], ring[i]),
                    normal(ring[i], ring[(i + 1) % n]),
                );
                let (mx, my) = (a.x + b.x, a.y + b.y);
                let m = mx.hypot(my).max(1e-9);
                // Miter length 1/cos(half angle), capped on sharp corners.
                let miter = (2.0 / m).min(2.0);
                adjusted.outer[i].x += mx / m * offset * miter;
                adjusted.outer[i].y += my / m * offset * miter;
            }
            if offset.abs() <= step * 0.45 && g::polygon(&adjusted).is_valid() {
                let next = g::dry_clip(&surface, &adjusted);
                if next.len() == 1
                    && next[0].holes.len() == original.holes.len()
                    && g::polygon(&next[0]).is_valid()
                    && anchors
                        .iter()
                        .filter(|&&p| g::contains(original, p) && g::contains(&clipped[0], p))
                        .all(|&p| g::contains(&next[0], p))
                {
                    clipped = next;
                }
            }
        }
        let candidate = &clipped[0];
        let original_area = g::area(original);
        let changed_area =
            area(&g::difference(original, candidate)) + area(&g::difference(candidate, original));
        let protected = anchors
            .iter()
            .copied()
            .filter(|&p| g::contains(original, p));
        // Boundary displacement scales with perimeter and grid spacing, not
        // just total area. An area-only 1% cap rejected valid smoothing of small
        // or elongated districts and restored their entire raw staircase.
        let perimeter: f64 = std::iter::once(&original.outer)
            .chain(&original.holes)
            .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
            .map(|(&a, &b)| distance(a, b))
            .sum();
        let accepted = changed_area <= (perimeter * step * 0.6).min(original_area * 0.08) + 0.001
            && (g::area(candidate) - original_area).abs() <= original_area * 0.02 + 0.001
            && g::contains(candidate, g::interior_point(original))
            && protected.into_iter().all(|p| g::contains(candidate, p));
        candidates.push(if accepted {
            candidate.clone()
        } else {
            original.clone()
        });
    }
    let original_holes: usize = shapes.iter().map(|s| s.holes.len()).sum();
    let topology = |candidates: &[Shape]| {
        let merged = union(candidates);
        let merged_holes: usize = merged.iter().map(|s| s.holes.len()).sum();
        (merged.len() == shapes.len()
            && merged_holes == original_holes
            && geo::MultiPolygon(merged.iter().map(g::polygon).collect()).is_valid())
        .then_some(merged)
    };
    if let Some(merged) = topology(&candidates) {
        return merged;
    }
    // Two smoothed neighbours that now touch revert alone, not the whole town:
    // a global revert restored the staircase on every district.
    let boxes: Vec<_> = candidates.iter().map(g::bbox).collect();
    for i in 0..candidates.len() {
        let touches = (0..candidates.len()).any(|j| {
            j != i
                && boxes[i].0 <= boxes[j].2
                && boxes[j].0 <= boxes[i].2
                && boxes[i].1 <= boxes[j].3
                && boxes[j].1 <= boxes[i].3
                && !g::intersection(&candidates[i], &candidates[j]).is_empty()
        });
        if touches {
            candidates[i] = shapes[i].clone();
        }
    }
    topology(&candidates).unwrap_or_else(|| shapes.to_vec())
}

/// Local distance bins bound the road-attraction work. Only road segments whose
/// expanded boxes touch a bin are queried; distant roads have zero attraction.
struct RoadField {
    bins: Vec<Vec<(Point, Point)>>,
    grid: (f64, f64, f64, f64),
    reach: f64,
}

/// Nearest water on the bounded growth lattice. Only land is ever allocated;
/// this attraction chooses which accessible dry side receives the next budget.
struct ShoreField {
    distances: Vec<f64>,
    sources: Vec<usize>,
}
impl ShoreField {
    fn new(grid: &Grid, surface: Surface<'_>) -> Self {
        let n = grid.nx * grid.ny;
        let mut result = Self {
            distances: vec![f64::INFINITY; n],
            sources: vec![usize::MAX; n],
        };
        let mut heap = std::collections::BinaryHeap::new();
        for i in 0..n {
            let p = grid.point(i);
            if p.x < surface.width && p.y < surface.width && surface.wet(p) {
                result.distances[i] = 0.0;
                result.sources[i] = i;
                heap.push(Arrival { cost: 0.0, cell: i });
            }
        }
        while let Some(Arrival { cost, cell }) = heap.pop() {
            if cost > result.distances[cell] + 1e-9 {
                continue;
            }
            let x = (cell % grid.nx) as isize;
            let y = (cell / grid.nx) as isize;
            for (dx, dy) in [
                (-1, -1),
                (0, -1),
                (1, -1),
                (-1, 0),
                (1, 0),
                (-1, 1),
                (0, 1),
                (1, 1),
            ] {
                let nx = x + dx;
                let ny = y + dy;
                if nx < 0 || ny < 0 || nx >= grid.nx as isize || ny >= grid.ny as isize {
                    continue;
                }
                let next = ny as usize * grid.nx + nx as usize;
                let value = cost + grid.step * (dx as f64).hypot(dy as f64);
                if value + 1e-9 < result.distances[next] {
                    result.distances[next] = value;
                    result.sources[next] = result.sources[cell];
                    heap.push(Arrival {
                        cost: value,
                        cell: next,
                    });
                }
            }
        }
        result
    }
}
impl RoadField {
    fn new(roads: &[Street], grid: &Grid, reach: f64) -> Self {
        let bounds = (
            grid.x0,
            grid.y0,
            grid.nx as f64 * grid.step / 16.0,
            grid.ny as f64 * grid.step / 16.0,
        );
        let mut result = Self {
            bins: vec![vec![]; 256],
            grid: bounds,
            reach,
        };
        for w in roads.iter().flat_map(|s| s.path.windows(2)) {
            let x0 = ((w[0].x.min(w[1].x) - reach - bounds.0) / bounds.2).floor();
            let y0 = ((w[0].y.min(w[1].y) - reach - bounds.1) / bounds.3).floor();
            let x1 = ((w[0].x.max(w[1].x) + reach - bounds.0) / bounds.2).floor();
            let y1 = ((w[0].y.max(w[1].y) + reach - bounds.1) / bounds.3).floor();
            if x1 < 0.0 || y1 < 0.0 || x0 > 15.0 || y0 > 15.0 {
                continue;
            }
            for y in y0.clamp(0.0, 15.0) as usize..=y1.clamp(0.0, 15.0) as usize {
                for x in x0.clamp(0.0, 15.0) as usize..=x1.clamp(0.0, 15.0) as usize {
                    result.bins[y * 16 + x].push((w[0], w[1]));
                }
            }
        }
        result
    }
    fn distance(&self, p: Point) -> f64 {
        let x = ((p.x - self.grid.0) / self.grid.2).floor().clamp(0.0, 15.0) as usize;
        let y = ((p.y - self.grid.1) / self.grid.3).floor().clamp(0.0, 15.0) as usize;
        self.bins[y * 16 + x]
            .iter()
            .map(|&(a, b)| g::distance(p, a, b).0)
            .fold(self.reach, f64::min)
    }
}

/// Physical service rules of accessible growth.
#[derive(Clone, Copy)]
struct Service {
    /// Steepest grade of a growth move (street grade, or stair grade where allowed).
    grade: f64,
    /// Enclosed open land smaller than this (m², about one block) is absorbed.
    min_gap: f64,
    /// Half-width of the faubourg ribbons along approach roads; zero disables.
    suburb_band: f64,
    /// Urban crossings the town may build over narrow water.
    crossing: crossings::Rules,
}

/// Absorb enclosed unselected lattice components smaller than `max_cells`:
/// an open space inside the town is at least a block, never a lattice square.
/// Real water inside an absorbed cell is clipped again from exact geography.
fn fill_holes(mask: &mut [bool], grid: &Grid, max_cells: usize) {
    let mut visited = vec![false; mask.len()];
    for root in 0..mask.len() {
        if mask[root] || visited[root] {
            continue;
        }
        visited[root] = true;
        let mut patch = vec![root];
        let (mut cursor, mut open) = (0, false);
        while cursor < patch.len() {
            let i = patch[cursor];
            cursor += 1;
            let (x, y) = (i % grid.nx, i / grid.nx);
            open |= x == 0 || y == 0 || x + 1 == grid.nx || y + 1 == grid.ny;
            for j in [
                i.wrapping_sub(1),
                i + 1,
                i.wrapping_sub(grid.nx),
                i + grid.nx,
            ] {
                let adjacent = j < mask.len() && (j / grid.nx == y || j % grid.nx == x);
                if adjacent && !mask[j] && !visited[j] {
                    visited[j] = true;
                    patch.push(j);
                }
            }
        }
        if !open && patch.len() < max_cells {
            for i in patch {
                mask[i] = true;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn accessible(
    target: f64,
    family: &str,
    cfg: &LayoutConfig,
    centers: &mut Vec<UrbanCenter>,
    radius: f64,
    angle: f64,
    fractions: &[f64],
    surface: Surface<'_>,
    roads: &[Street],
    rng: &Rng,
    grade_limit: f64,
    water_affinity: f64,
    service: Service,
) -> (Vec<Shape>, Vec<Vec<Shape>>, Vec<Street>) {
    let aspect = if matches!(family, "elongated" | "linear") {
        cfg.footprint.aspect.max(2.8)
    } else {
        cfg.footprint.aspect
    };
    let reach = radius * 2.65 * aspect.sqrt();
    let mut x0 = centers
        .iter()
        .map(|c| c.point.x - reach)
        .fold(f64::INFINITY, f64::min)
        .max(0.0);
    let mut y0 = centers
        .iter()
        .map(|c| c.point.y - reach)
        .fold(f64::INFINITY, f64::min)
        .max(0.0);
    let x1 = centers
        .iter()
        .map(|c| c.point.x + reach)
        .fold(f64::NEG_INFINITY, f64::max)
        .min(surface.width);
    let y1 = centers
        .iter()
        .map(|c| c.point.y + reach)
        .fold(f64::NEG_INFINITY, f64::max)
        .min(surface.width);
    let step = ((x1 - x0).max(y1 - y0) / 192.0).max(1.0);
    x0 = (x0 / step).floor() * step;
    y0 = (y0 / step).floor() * step;
    let grid = Grid {
        x0,
        y0,
        step,
        nx: (((x1 - x0) / step).ceil() as usize).clamp(1, 192),
        ny: (((y1 - y0) / step).ceil() as usize).clamp(1, 192),
    };
    let n = grid.nx * grid.ny;
    let field = RoadField::new(roads, &grid, radius * 0.35);
    let shore = ShoreField::new(&grid, surface);
    let noise = crate::noise::Noise::new(rng.fork("growth-cost"));
    let mut dry_mask = vec![false; n];
    let mut heights = vec![0.0; n];
    let mut costs = vec![1.0; n];
    let porous = sparse::enabled(cfg);
    let strongest = centers.iter().map(|c| c.weight).fold(0.0, f64::max);
    let open_space = crate::noise::Noise::new(rng.fork("growth-open-space"));
    let mut occupied = vec![true; n];
    let mut road_distance = vec![0.0; n];
    for i in 0..n {
        let p = grid.point(i);
        let mut grade: f64 = 0.0;
        for (dx, dy) in [
            (0.0, 0.0),
            (0.35, 0.0),
            (-0.35, 0.0),
            (0.0, 0.35),
            (0.0, -0.35),
        ] {
            let (gx, gy) = slope(
                surface,
                Point {
                    x: p.x + dx * step,
                    y: p.y + dy * step,
                },
            );
            grade = grade.max(gx.hypot(gy));
        }
        dry_mask[i] = !surface.wet(p) && grade <= grade_limit;
        heights[i] = surface.height_at(p);
        let rd = field.distance(p);
        road_distance[i] = rd;
        let road_attraction = if family == "linear" {
            0.95
        } else if matches!(family, "fingers" | "dendritic") {
            0.8
        } else {
            0.55
        };
        let attraction = 1.0
            - cfg.footprint.anisotropy * road_attraction * (-rd / (radius * 0.07).max(step)).exp();
        let branches =
            1.0 - cfg.footprint.branch_depth * 0.85 * (-rd / (radius * 0.06).max(step)).exp();
        let scale = radius.max(1.0);
        let broad = noise.fbm(p.x / (scale * 0.9), p.y / (scale * 0.9), 3);
        let medium = noise.fbm(p.x / (scale * 0.32) + 17.0, p.y / (scale * 0.32) - 11.0, 2);
        let fine = noise.noise(p.x / (scale * 0.12) - 7.0, p.y / (scale * 0.12) + 23.0);
        let variation =
            (cfg.footprint.irregularity.sqrt() * 0.8 * (2.0 * broad + medium + 0.25 * fine)).exp();
        let terrain = 1.0
            + (0.35 + cfg.footprint.anisotropy * 0.65)
                * (grade * 2.5 + (grade / grade_limit).powi(2) * 4.0);
        let local_reach = centers
            .iter()
            .map(|c| distance(p, c.point))
            .fold(f64::INFINITY, f64::min)
            / reach;
        // A soft terminal cost, outside the ordinary target, prevents a scarce
        // valley budget from filling the rectangular calculation window.
        let terminal = 1.0 + 18.0 * ((local_reach - 0.72) / 0.28).max(0.0).powi(4);
        let resource = 1.0
            - (0.2 + water_affinity * 0.8).min(0.7)
                * (-shore.distances[i] / (radius * 0.6).max(20.0)).exp();
        costs[i] = attraction * branches * resource * variation * terrain * terminal;
        if porous {
            // A small satellite protects a smaller core than the main town;
            // overlapping full-size core exemptions would erase its gaps.
            let core_distance = centers
                .iter()
                .map(|c| distance(p, c.point) / (c.weight / strongest).sqrt().max(0.2))
                .fold(f64::INFINITY, f64::min);
            occupied[i] = sparse::occupied(
                cfg,
                &open_space,
                p,
                radius,
                step,
                core_distance,
                grade / grade_limit,
            );
        }
        if family == "fan" {
            let c = centers[0].point;
            let q = rotate(
                Point {
                    x: p.x - c.x,
                    y: p.y - c.y,
                },
                -angle,
            );
            if q.x < -radius * 0.12 || q.y.abs() > q.x.max(radius * 0.15) * 1.2 {
                dry_mask[i] = false;
            }
        }
    }
    if porous {
        sparse::resolve_gaps(&mut occupied, &dry_mask, &grid, cfg.footprint.gap_size);
    }
    // Water stays a barrier except along existing regional crossings: a town
    // spans its river through the bridge, ford or causeway it was founded on,
    // and never invents one. Each crossing joins the nearest buildable cells of
    // its two ends; the span costs more than the same length of open land, so
    // the far bank receives a bridgehead quarter rather than an equal share.
    let mut crossings: Vec<Vec<(usize, f64, usize)>> = vec![vec![]; n];
    let landing = |p: Point| {
        if p.x < grid.x0 || p.y < grid.y0 {
            return None;
        }
        let (cx, cy) = ((p.x - grid.x0) / step, (p.y - grid.y0) / step);
        if cx >= grid.nx as f64 + 2.0 || cy >= grid.ny as f64 + 2.0 {
            return None;
        }
        let (cx, cy) = (cx.floor() as isize, cy.floor() as isize);
        (cy - 3..=cy + 3)
            .flat_map(|y| (cx - 3..=cx + 3).map(move |x| (x, y)))
            .filter(|&(x, y)| x >= 0 && y >= 0 && x < grid.nx as isize && y < grid.ny as isize)
            .map(|(x, y)| y as usize * grid.nx + x as usize)
            .filter(|&i| dry_mask[i] && distance(grid.point(i), p) <= step * 3.0)
            .min_by(|&a, &b| distance(grid.point(a), p).total_cmp(&distance(grid.point(b), p)))
    };
    for road in roads {
        let penalty = match road.role.as_str() {
            "bridge" => 2.5,
            "causeway" => 3.0,
            "ford" => 4.0,
            _ => continue,
        };
        let (Some(&a), Some(&b)) = (road.path.first(), road.path.last()) else {
            continue;
        };
        let (Some(i), Some(j)) = (landing(a), landing(b)) else {
            continue;
        };
        if i == j {
            continue;
        }
        let span = road
            .path
            .windows(2)
            .map(|w| distance(w[0], w[1]))
            .sum::<f64>()
            + distance(grid.point(i), a)
            + distance(grid.point(j), b);
        crossings[i].push((j, span * penalty, usize::MAX));
        crossings[j].push((i, span * penalty, usize::MAX));
    }
    // Where no regional crossing serves a bank, the town may build its own
    // over water narrower than its builders' span, at the narrow points.
    let fixed = roads
        .iter()
        .filter(|r| matches!(r.role.as_str(), "bridge" | "ford" | "causeway"))
        .filter_map(|r| Some((*r.path.first()?, *r.path.last()?)))
        .collect::<Vec<_>>();
    let urban = crossings::candidates(&grid, &dry_mask, surface, &service.crossing, &fixed);
    for (id, c) in urban.iter().enumerate() {
        let cost = c.cost(&grid);
        crossings[c.from].push((c.to, cost, id));
        crossings[c.to].push((c.from, cost, id));
    }
    let mut via = vec![usize::MAX; n];
    let mut bridged = vec![false; n];
    let mut arrivals = vec![f64::INFINITY; n];
    let mut parents = vec![usize::MAX; n];
    let mut heap = BinaryHeap::new();
    let mut active_centers = vec![];
    for c in centers.iter_mut() {
        let nominal = grid.nearest(c.point);
        let seed = (0..n).filter(|&i| dry_mask[i]).min_by(|&a, &b| {
            distance(grid.point(a), c.point).total_cmp(&distance(grid.point(b), c.point))
        });
        if let Some(i) =
            seed.filter(|&i| distance(grid.point(i), grid.point(nominal)) < radius * 0.7)
        {
            c.point = grid.point(i);
            active_centers.push(c.id);
            occupied[i] = true;
            if arrivals[i] > 0.0 {
                let cost = if porous {
                    (1.0 - c.weight / strongest) * radius * 0.8
                } else {
                    0.0
                };
                arrivals[i] = cost;
                heap.push(Arrival { cost, cell: i });
            }
        }
    }
    centers.retain(|c| active_centers.contains(&c.id));
    for (i, c) in centers.iter_mut().enumerate() {
        c.id = i;
    }
    let dirs: [(isize, isize); 16] = [
        (1, 0),
        (2, 1),
        (1, 1),
        (1, 2),
        (0, 1),
        (-1, 2),
        (-1, 1),
        (-2, 1),
        (-1, 0),
        (-2, -1),
        (-1, -1),
        (-1, -2),
        (0, -1),
        (1, -2),
        (1, -1),
        (2, -1),
    ];
    let mut order = vec![];
    let mut finalized = vec![false; n];
    let mut selected = vec![false; n];
    let budget = (target / step.powi(2)).ceil() as usize;
    // Faubourgs: once the walled (or older) epochs are complete, the last
    // epoch restarts from the whole town with a cost that rises away from the
    // approach roads, so it grows as ribbons out of the gates.
    let suburb_start = match (service.suburb_band, fractions.len()) {
        (band, epochs) if band > 0.0 && epochs >= 2 => {
            (budget as f64 * fractions[epochs - 2]).ceil() as usize
        }
        _ => usize::MAX,
    };
    let mut suburban = false;
    while let Some(Arrival { cost, cell }) = heap.pop() {
        if cost > arrivals[cell] + 1e-9 || finalized[cell] {
            continue;
        }
        finalized[cell] = true;
        let connection = if parents[cell] == usize::MAX || bridged[cell] {
            vec![cell]
        } else {
            grid.move_cells(parents[cell], cell, &costs)
        };
        for i in connection {
            if !selected[i] && occupied[i] {
                selected[i] = true;
                order.push(i);
            }
        }
        if order.len() >= budget {
            break;
        }
        if !suburban && order.len() >= suburb_start {
            suburban = true;
            let band = service.suburb_band;
            for i in 0..n {
                costs[i] *= 1.0 + 8.0 * ((road_distance[i] - band) / band).clamp(0.0, 1.0);
                finalized[i] = false;
                arrivals[i] = if selected[i] { 0.0 } else { f64::INFINITY };
            }
            heap.clear();
            heap.extend(order.iter().map(|&cell| Arrival { cost: 0.0, cell }));
            continue;
        }
        let (x, y) = (cell % grid.nx, cell / grid.nx);
        for (dx, dy) in dirs {
            let (nx, ny) = (x as isize + dx, y as isize + dy);
            if nx < 0 || ny < 0 || nx >= grid.nx as isize || ny >= grid.ny as isize {
                continue;
            }
            let next = ny as usize * grid.nx + nx as usize;
            if !dry_mask[next] {
                continue;
            }
            // Four-connected land is authoritative; a diagonal cannot slip
            // between touching water corners and join two separate dry masses.
            if dx.abs() <= 1
                && dy.abs() <= 1
                && dx != 0
                && dy != 0
                && (!dry_mask[y * grid.nx + nx as usize] || !dry_mask[ny as usize * grid.nx + x])
            {
                continue;
            }
            let p = grid.point(cell);
            let q = grid.point(next);
            // Land is urban only if a street can reach it: every growth move
            // must be passable at street grade (stair grade only where the
            // culture builds stairs), so a slope is climbed by switchbacks
            // along the contours or not at all.
            if !routing::segment_clear(surface, p, q, service.grade) {
                continue;
            }
            let samples = dx.abs().max(dy.abs()) * 2;
            if (1..samples).any(|j| {
                let t = j as f64 / samples as f64;
                !dry_mask[grid.nearest(Point {
                    x: p.x + (q.x - p.x) * t,
                    y: p.y + (q.y - p.y) * t,
                })]
            }) {
                continue;
            }
            let v = rotate(
                Point {
                    x: dx as f64,
                    y: dy as f64,
                },
                -angle,
            );
            let stretch = if matches!(family, "elongated" | "linear") {
                ((v.x / aspect.sqrt()).powi(2) + (v.y * aspect.sqrt()).powi(2)).sqrt()
            } else {
                (dx as f64).hypot(dy as f64)
            };
            let grade =
                (heights[next] - heights[cell]).abs() / (step * (dx as f64).hypot(dy as f64));
            let terrain =
                1.0 + cfg.footprint.anisotropy * (grade * 6.0 + grade.powi(2) * 35.0).min(15.0);
            let quadrature = dx.abs().max(dy.abs()) * 4;
            let local_cost = (0..quadrature)
                .map(|j| {
                    let t = (j as f64 + 0.5) / quadrature as f64;
                    costs[grid.nearest(Point {
                        x: p.x + (q.x - p.x) * t,
                        y: p.y + (q.y - p.y) * t,
                    })]
                })
                .sum::<f64>()
                / quadrature as f64;
            let next_cost = cost + step * stretch * terrain * local_cost;
            if next_cost + 1e-9 < arrivals[next] {
                arrivals[next] = next_cost;
                parents[next] = cell;
                bridged[next] = false;
                via[next] = usize::MAX;
                heap.push(Arrival {
                    cost: next_cost,
                    cell: next,
                });
            }
        }
        for &(next, span, id) in &crossings[cell] {
            let next_cost = cost + span * costs[next];
            if !finalized[next] && next_cost + 1e-9 < arrivals[next] {
                arrivals[next] = next_cost;
                parents[next] = cell;
                bridged[next] = true;
                via[next] = id;
                heap.push(Arrival {
                    cost: next_cost,
                    cell: next,
                });
            }
        }
    }
    // A bank reached only over a crossing has no centre of its own yet.
    let landings = (0..n)
        .filter(|&i| bridged[i] && selected[i])
        .map(|i| grid.point(i))
        .collect::<Vec<_>>();
    let reserve = vec![g::rectangle(x0, y0, x1, y1)];
    let land = |mask: &[bool]| {
        dry(surface, &grid.contours(mask))
            .into_iter()
            .filter(|s| {
                porous
                    || centers.iter().any(|c| g::contains(s, c.point))
                    || landings.iter().any(|&p| g::contains(s, p))
            })
            .collect::<Vec<_>>()
    };
    let mut final_mask = vec![false; n];
    for &i in &order {
        final_mask[i] = true;
    }
    let fill = (service.min_gap / step.powi(2)).ceil() as usize;
    fill_holes(&mut final_mask, &grid, fill);
    let mut anchors = grid.boundary_centers(&final_mask);
    anchors.extend(centers.iter().map(|c| c.point));
    let final_land = smooth_growth(&land(&final_mask), step, surface, &anchors);
    let mut phases = vec![];
    let mut previous: Vec<Shape> = vec![];
    let epochs = fractions.len();
    for (epoch, &fraction) in fractions.iter().enumerate() {
        let take = ((order.len() as f64 * fraction).round() as usize).min(order.len());
        let mut mask = vec![false; n];
        for &i in &order[..take] {
            mask[i] = true;
        }
        fill_holes(&mut mask, &grid, fill);
        let grown = if epoch + 1 == epochs {
            final_land.clone()
        } else {
            let mut anchors = grid.boundary_centers(&mask);
            anchors.extend(centers.iter().map(|c| c.point));
            let connected = smooth_growth(&land(&mask), step, surface, &anchors);
            let clipped = connected
                .iter()
                .flat_map(|s| final_land.iter().flat_map(move |f| g::intersection(s, f)))
                .collect::<Vec<_>>();
            union(&[previous.clone(), clipped].concat())
        };
        phases.push(subtract(&grown, &previous));
        previous = grown;
    }
    // A built crossing joins two selected banks; it becomes a street.
    let mut built = (0..n)
        .filter(|&i| selected[i] && via[i] != usize::MAX && selected[parents[i]])
        .map(|i| via[i])
        .collect::<Vec<_>>();
    built.sort_unstable();
    built.dedup();
    let streets = built
        .into_iter()
        .flat_map(|id| urban[id].streets(&grid, &service.crossing))
        .collect();
    (reserve, phases, streets)
}

#[allow(clippy::too_many_arguments)]
fn ribbon(
    target: f64,
    cfg: &LayoutConfig,
    centers: &[UrbanCenter],
    radius: f64,
    angle: f64,
    fractions: &[f64],
    surface: Surface<'_>,
    roads: &[Street],
    water_affinity: f64,
) -> (Vec<Shape>, Vec<Vec<Shape>>, bool) {
    let c = centers[0].point;
    let rx = radius * cfg.footprint.aspect.max(3.0).sqrt() * 1.55;
    let ry = radius / cfg.footprint.aspect.max(3.0).sqrt() * 1.35;
    let reserve = template(c, "rectangle", (rx * ry).sqrt(), rx / ry, angle, 0.0, 0.0);
    let bounds = g::bbox(&reserve);
    let step = (surface.width / surface.n as f64)
        .max(((bounds.2 - bounds.0).max(bounds.3 - bounds.1) + radius * 4.0) / 160.0);
    let grid = Grid {
        x0: (bounds.0 - radius * 2.0).max(0.0),
        y0: (bounds.1 - radius * 2.0).max(0.0),
        step,
        nx: (((bounds.2 + radius * 2.0).min(surface.width) - (bounds.0 - radius * 2.0).max(0.0))
            / step)
            .floor() as usize
            + 1,
        ny: (((bounds.3 + radius * 2.0).min(surface.width) - (bounds.1 - radius * 2.0).max(0.0))
            / step)
            .floor() as usize
            + 1,
    };
    let shore = ShoreField::new(&grid, surface);
    let paths: Vec<_> = roads
        .iter()
        .flat_map(|s| macroplan::clip(s, &reserve))
        .filter(|s| {
            s.path
                .windows(2)
                .any(|w| g::distance(c, w[0], w[1]).0 < radius * 0.65)
        })
        .collect();
    let fallback = paths.is_empty();
    let paths = if fallback {
        vec![Street {
            path: vec![
                at(
                    c,
                    Point {
                        x: -rx * 0.95,
                        y: 0.0,
                    },
                    angle,
                ),
                at(
                    c,
                    Point {
                        x: rx * 0.95,
                        y: 0.0,
                    },
                    angle,
                ),
            ],
            widths: vec![5.0; 2],
            rank: 1,
            role: "street".into(),
        }]
    } else {
        paths
    };
    let make = |width: f64| {
        union(
            &paths
                .iter()
                .flat_map(|s| {
                    let widths: Vec<_> = s
                        .path
                        .iter()
                        .map(|&p| width * (0.38 + 0.62 * (-distance(p, c) / radius.max(1.0)).exp()))
                        .collect();
                    let biased: Vec<_> = s
                        .path
                        .iter()
                        .zip(&widths)
                        .map(|(&p, &w)| {
                            let cell = grid.nearest(p);
                            let source = shore.sources[cell];
                            if source == usize::MAX || shore.distances[cell] > radius * 2.5 {
                                return p;
                            }
                            let q = grid.point(source);
                            let d = distance(p, q).max(1.0);
                            let shift = w * (0.08 + water_affinity * 0.25).min(0.25);
                            Point {
                                x: p.x + (q.x - p.x) / d * shift,
                                y: p.y + (q.y - p.y) / d * shift,
                            }
                        })
                        .collect();
                    g::ribbon(&biased, &widths)
                })
                .flat_map(|s| g::intersection(&s, &reserve))
                .collect::<Vec<_>>(),
        )
    };
    let (mut lo, mut hi) = (1.0, ry * 2.0);
    for _ in 0..12 {
        let mid = (lo + hi) * 0.5;
        if area(&make(mid)) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let width = (lo + hi) * 0.5;
    let mut previous: Vec<Shape> = vec![];
    let mut phases = vec![];
    for &fraction in fractions {
        let grown = union(&[previous.clone(), dry(surface, &make(width * fraction))].concat());
        phases.push(subtract(&grown, &previous));
        previous = grown;
    }
    (vec![reserve], phases, fallback)
}

pub(super) fn generate(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    morph: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
) -> Footprint {
    let rng = Rng::new(seed).fork("urban-footprint-v1");
    let (nominal, density) = budget(site, cfg, morph, radius);
    // Adaptive capacity: the footprint is sized for the households its own
    // tissue can hold (densified first, then extended within a bound).
    let plan_epochs = capacity_epochs(site, cfg, morph, nominal, surface);
    let tick = std::time::Instant::now();
    let mut plan = capacity::plan(site, cfg, &plan_epochs, nominal, None);
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  capacity.plan: {:.0} ms",
            tick.elapsed().as_secs_f64() * 1000.0
        );
    }
    let target = nominal * plan.as_ref().map_or(1.0, |p| p.extension);
    let density = density * nominal / target;
    let radius = (target / PI).sqrt();
    let geography = geography(site, cfg, surface, radius);
    let family = family(site, cfg, geography, radius);
    let mechanism = mechanism(cfg, family);
    let angle = if cfg.footprint.family == "auto" && family == "elongated" {
        geography.contour_angle + cfg.footprint.orientation.to_radians()
    } else {
        orientation(site, cfg, surface, roads)
    };
    let mut centers = centers(site, cfg, family, mechanism, radius, angle, surface, &rng);
    let epochs = cfg.footprint.epochs;
    let fractions = epoch_fractions(&epoch_densities(site, cfg, morph));
    let natural = mechanism != "planned"
        && !(mechanism == "ribbon"
            && cfg.footprint.mechanism == "ribbon"
            && compatible_foundation(geography, radius));
    if natural && cfg.suburbs != "none" {
        sparse::satellites(
            &mut centers,
            cfg,
            surface,
            roads,
            radius,
            buildable_grade(site, cfg),
            &rng,
        );
    }
    let guide_family = if natural
        && cfg.footprint.branch_depth > 0.0
        && !matches!(family, "fingers" | "dendritic" | "linear")
    {
        "dendritic"
    } else {
        family
    };
    let guide_radius = radius
        * (1.0
            + if natural {
                cfg.footprint.branch_depth * 0.8
            } else {
                0.0
            });
    let mut guides = centers
        .first()
        .map(|c| guides(guide_family, c.point, guide_radius, angle, &rng))
        .unwrap_or_default();
    let growth_roads = [roads, guides.as_slice()].concat();
    let mut warnings = vec![];
    if centers.is_empty() {
        warnings.push("Aucun noyau sec disponible : le budget urbain reste non attribué.".into());
    }
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let mut foundation_cfg = cfg.clone();
    if cfg.footprint.family == "auto"
        && profiles::settlement_profile(culture, site.population, cfg.footprint.epochs).enclosure
            == "square"
    {
        foundation_cfg.footprint.aspect = 1.0;
    }
    let (reserve, mut phases, mut crossings) = if centers.is_empty() {
        (vec![], vec![vec![]; epochs], vec![])
    } else if mechanism == "planned" {
        let (r, p) = planned(
            target,
            family,
            &foundation_cfg,
            &centers,
            angle,
            &fractions,
            surface,
            &rng,
        );
        (r, p, vec![])
    } else if mechanism == "ribbon"
        && cfg.footprint.mechanism == "ribbon"
        && compatible_foundation(geography, radius)
    {
        let (r, p, fallback) = ribbon(
            target,
            &foundation_cfg,
            &centers,
            radius,
            angle,
            &fractions,
            surface,
            roads,
            morph.value["growth"]["water"].as_f64().unwrap_or(0.3),
        );
        if fallback {
            warnings.push(
                "Aucune route régionale proche : une fondation linéaire fournit l'axe du ruban."
                    .into(),
            );
        }
        (r, p, vec![])
    } else {
        let profile = profiles::settlement_profile(culture, site.population, epochs);
        let walled = matches!(
            profiles::fortification(profile, &cfg.fortification, site.population),
            "wall" | "palisade" | "hedge"
        );
        let block = morph.range("blockSize", "edge")[0];
        let service = Service {
            grade: if profiles::stairs_allowed(cfg, culture) {
                cfg.max_stair_grade
            } else {
                cfg.max_street_grade
            },
            min_gap: if block > 0.0 { block } else { 2500.0 },
            suburb_band: if site.population >= 1200
                && cfg.suburbs != "none"
                && (epochs >= 3 || walled && epochs >= 2)
            {
                (morph.range("plotDepth", "edge")[1] * 1.5).clamp(30.0, 90.0)
            } else {
                0.0
            },
            crossing: {
                let (max_span, ford) = crossings::spans(culture, site.population);
                crossings::Rules {
                    max_span,
                    ford,
                    width: morph.width(1, &mut rng.fork("urban-crossing-width")),
                    grade: cfg.max_street_grade,
                }
            },
        };
        accessible(
            target,
            family,
            cfg,
            &mut centers,
            radius,
            angle,
            &fractions,
            surface,
            &growth_roads,
            &rng,
            if cfg.tissue == "terraces" {
                0.5
            } else {
                buildable_grade(site, cfg)
            },
            morph.value["growth"]["water"].as_f64().unwrap_or(0.3),
            service,
        )
    };
    let mut links = if natural && sparse::enabled(cfg) {
        let served = [roads, crossings.as_slice()].concat();
        sparse::serve(&mut phases, &centers, cfg, surface, radius, target, &served)
    } else {
        vec![]
    };
    let allocated = union(&phases.iter().flatten().cloned().collect::<Vec<_>>());
    // An urban crossing survives only between two retained banks: its
    // approaches start and end on allocated land.
    for chain in crossings.chunk_by(|a, b| a.path.last() == b.path.first()) {
        let (Some(a), Some(b)) = (chain.first(), chain.last()) else {
            continue;
        };
        if [a.path[0], *b.path.last().unwrap()]
            .iter()
            .all(|&p| allocated.iter().any(|s| g::contains(s, p)))
        {
            links.extend(chain.iter().cloned());
        }
    }
    crossings.clear();
    let allocated_area = area(&allocated);
    centers.retain(|c| allocated.iter().any(|s| g::contains(s, c.point)));
    for (i, c) in centers.iter_mut().enumerate() {
        c.id = i;
    }
    if centers.is_empty() {
        phases.clear();
        guides.clear();
        if allocated.is_empty() && warnings.is_empty() {
            warnings.push(
                "Aucun noyau constructible accessible : le programme reste non attribué.".into(),
            );
        }
    } else if mechanism != "planned" {
        guides = self::guides(guide_family, centers[0].point, guide_radius, angle, &rng);
    }
    // A planned outline cut by a river can intentionally allocate several dry
    // masses. Give each mass an explicit service center rather than inventing a
    // crossing or discarding all but the mass containing the original marker.
    for domain in &allocated {
        if !centers.iter().any(|c| g::contains(domain, c.point)) {
            centers.push(UrbanCenter {
                id: centers.len(),
                point: g::interior_point(domain),
                weight: g::area(domain) / allocated_area.max(1.0),
            });
        }
    }
    let center_weight: f64 = centers.iter().map(|c| c.weight).sum();
    for c in &mut centers {
        c.weight /= center_weight.max(1.0e-9);
    }
    let shortfall = (target - allocated_area).max(0.0);
    // Terrain-bounded growth: plan again on the land actually attributed.
    if let Some(p) = plan.as_mut()
        && shortfall > target * 0.02
        && let Some(mut again) =
            capacity::plan(site, cfg, &plan_epochs, nominal, Some(allocated_area))
    {
        again.extension = p.extension;
        *p = again;
    }
    if shortfall > target * 0.02 {
        warnings.push(format!(
            "Emprise contrainte : {:.0} m² attribués sur {:.0} m² prévus ({:.1} % de déficit).",
            allocated_area,
            target,
            shortfall / target * 100.0
        ));
    }
    let mut history = vec![];
    let mut cumulative = vec![];
    for (epoch, shapes) in phases.iter().enumerate() {
        let prior_components = cumulative.len();
        cumulative = union(&[cumulative, shapes.clone()].concat());
        let kind = if epoch == 0 {
            "foundation"
        } else if mechanism == "planned" {
            "planned-extension"
        } else if mechanism == "fusion" && cumulative.len() < prior_components {
            "nucleus-merger"
        } else if mechanism == "fusion" {
            "nucleus-growth"
        } else if mechanism == "ribbon" {
            "road-accretion"
        } else {
            "accessible-extension"
        };
        history.push(UrbanEvent {
            epoch,
            kind: kind.into(),
            center: if family == "composite" && epoch > 0 {
                centers.len().saturating_sub(1)
            } else {
                0
            },
            area: area(shapes),
        });
    }
    let reserve_area = area(&dry(surface, &reserve));
    let components = allocated.len();
    let structure = UrbanStructure {
        version: 1,
        mechanism: mechanism.into(),
        family: family.into(),
        reserve,
        allocated,
        centers,
        districts: vec![],
        history,
        metrics: UrbanMetrics {
            target_area: target,
            allocated_area,
            street_area: 0.0,
            reserved_area: (reserve_area - allocated_area).max(0.0),
            gross_density: density,
            planned_population: site.population as f64,
            shortfall_area: shortfall,
            components,
            access_added: 0,
            capacity: plan,
        },
    };
    if cfg.footprint.budget == "population" && cfg.footprint.gross_density <= 0.0 {
        let densities = epoch_densities(site, cfg, morph)
            .iter()
            .map(|d| format!("{d:.0}"))
            .collect::<Vec<_>>()
            .join(" / ");
        warnings.push(format!("Budget foncier automatique : {density:.1} hab./ha brut en moyenne ; densités par époque (cœur → périphérie) {densities} hab./ha ; budget de composition, pas une capacité bâtie."));
    }
    Footprint {
        structure,
        phases,
        radius,
        warnings,
        guides,
        links,
    }
}

#[cfg(test)]
mod tests {
    use super::super::{FootprintConfig, resolve};
    use super::*;

    /// Invariant (adaptive capacity, step 4): a sparse tissue that its own
    /// densified cutting cannot house on bounded land borrows the cutting of a
    /// compact tissue on a share of its quarters (never its houses), and the
    /// plan states it with its numbers.
    #[test]
    fn a_bounded_sparse_tissue_borrows_a_compact_cutting_and_says_so() {
        let h = vec![10.0; 128 * 128];
        let w = vec![0; h.len()];
        let surface = Surface {
            geometry: None,
            width: 6000.0,
            n: 128,
            height: &h,
            water: &w,
        };
        let site = Site {
            key: "capacity".into(),
            name: String::new(),
            population: 20_000,
            culture: "halfling".into(),
            center: Point {
                x: 3000.0,
                y: 3000.0,
            },
            radius: 600.0,
        };
        let cfg = LayoutConfig {
            culture: "site".into(),
            ..LayoutConfig::default()
        };
        let morph = resolve(
            "halfling",
            "culture",
            "auto",
            "core",
            1.0,
            &serde_json::json!({}),
            "quarters",
        )
        .unwrap();
        let (nominal, _) = budget(&site, &cfg, &morph, 600.0);
        let epochs = capacity_epochs(&site, &cfg, &morph, nominal, surface);
        // The terrain grants half the nominal land: no extension is possible.
        let plan = capacity::plan(&site, &cfg, &epochs, nominal, Some(nominal * 0.5)).unwrap();
        let text = capacity::describe("halfling", &plan).join(", ");
        eprintln!("{text}; {plan:?}");
        assert!(plan.extension <= 1.0 && plan.densify >= 1.0);
        assert!(!plan.donor.is_empty() && plan.borrowed_share > 0.0 && plan.borrowed_share <= 1.0);
        assert!(plan.donor_yield > plan.planned_yield);
        assert!(text.contains("découpe empruntée à"), "{text}");
    }
    fn input() -> (Site, Morph) {
        (
            Site {
                key: "footprint".into(),
                name: String::new(),
                population: 1000,
                culture: "european-organic".into(),
                center: Point {
                    x: 1500.0,
                    y: 1500.0,
                },
                radius: 250.0,
            },
            resolve(
                "european-organic",
                "culture",
                "core",
                "core",
                1.0,
                &serde_json::json!({}),
                "quarters",
            )
            .unwrap(),
        )
    }
    #[test]
    fn automatic_population_budget_follows_catalogue_cadence_without_overriding_manual_or_radius() {
        let (mut site, morph) = input();
        site.population = 50_000;
        let mut cfg = LayoutConfig::default();
        let (target, density) = budget(&site, &cfg, &morph, 250.0);
        let densities = epoch_densities(&site, &cfg, &morph);
        // Core denser than its periphery, and a larger city has a denser core.
        assert!(densities.windows(2).all(|d| d[0] > d[1]), "{densities:?}");
        site.population = 5_000;
        assert!(epoch_densities(&site, &cfg, &morph)[0] < densities[0]);
        site.population = 50_000;
        assert!(density > 100.0 && density < densities[0]);
        assert!((target - site.population as f64 / density * 10_000.0).abs() < 1e-5);
        let fractions = epoch_fractions(&densities);
        assert!(fractions[0] < 1.0 / 3.0 && (fractions[2] - 1.0).abs() < 1e-9);
        cfg.footprint.gross_density = 185.0;
        let explicit = budget(&site, &cfg, &morph, 250.0);
        assert_eq!(explicit.1, 185.0);
        assert!((explicit.0 - 50_000.0 / 185.0 * 10_000.0).abs() < 1e-6);
        cfg.footprint.budget = "radius".into();
        let manual_radius = budget(&site, &cfg, &morph, 250.0);
        cfg.footprint.gross_density = 0.0;
        assert_eq!(manual_radius, budget(&site, &cfg, &morph, 250.0));
        assert_eq!(manual_radius.0, PI * 250.0 * 250.0);
    }
    #[test]
    fn porous_growth_is_seeded_and_keeps_a_measured_population_budget() {
        let (site, morph) = input();
        let height = vec![100.0; 128 * 128];
        let water = vec![0; height.len()];
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n: 128,
            height: &height,
            water: &water,
        };
        let mut cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "dendritic".into(),
                gross_density: 70.0,
                cohesion: 0.6,
                satellites: 0.7,
                branch_depth: 0.6,
                gap_size: 100.0,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        let grown = generate(
            "porous-regression-2026-10-20",
            &site,
            &cfg,
            &morph,
            surface,
            &[],
            250.0,
        );
        let replay = generate(
            "porous-regression-2026-10-20",
            &site,
            &cfg,
            &morph,
            surface,
            &[],
            250.0,
        );
        assert_eq!(
            serde_json::to_string(&(&grown.structure, &grown.links)).unwrap(),
            serde_json::to_string(&(&replay.structure, &replay.links)).unwrap()
        );
        assert!(grown.structure.metrics.allocated_area > grown.structure.metrics.target_area * 0.9);
        assert!(
            grown.structure.metrics.allocated_area < grown.structure.metrics.target_area * 1.02
        );
        assert!(grown.structure.centers.iter().all(|c| {
            grown
                .structure
                .allocated
                .iter()
                .any(|s| g::contains(s, c.point))
        }));
        assert!(grown.links.iter().all(|s| routing::path_clear(
            surface,
            &s.path,
            if s.role == "stairs" {
                cfg.max_stair_grade
            } else {
                cfg.max_lane_grade
            }
        )));
        cfg.footprint.cohesion = 1.0;
        cfg.footprint.satellites = 0.0;
        cfg.footprint.branch_depth = 0.0;
        let compact = generate(
            "porous-regression-2026-10-20",
            &site,
            &cfg,
            &morph,
            surface,
            &[],
            250.0,
        );
        let overlap: f64 = grown
            .structure
            .allocated
            .iter()
            .flat_map(|a| {
                compact
                    .structure
                    .allocated
                    .iter()
                    .flat_map(move |b| g::intersection(a, b))
            })
            .map(|s| g::area(&s))
            .sum();
        assert!(overlap < grown.structure.metrics.allocated_area * 0.95);
    }

    #[test]
    fn population_budget_and_chronology_are_replayable_without_overlap() {
        let (site, morph) = input();
        let h = vec![0.0; 128 * 128];
        let w = vec![0; h.len()];
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n: 128,
            height: &h,
            water: &w,
        };
        let cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "rectangle".into(),
                gross_density: 50.0,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        let a = generate("footprint", &site, &cfg, &morph, surface, &[], 250.0);
        let b = generate("footprint", &site, &cfg, &morph, surface, &[], 900.0);
        assert_eq!(
            serde_json::to_string(&a.structure).unwrap(),
            serde_json::to_string(&b.structure).unwrap()
        );
        assert!((a.structure.metrics.target_area - 200_000.0).abs() < 0.01);
        let mut artistic_scale = cfg.clone();
        artistic_scale.radius_scale = 4.0;
        let unchanged_budget = generate(
            "footprint",
            &site,
            &artistic_scale,
            &morph,
            surface,
            &[],
            250.0,
        );
        assert_eq!(
            serde_json::to_string(&a.structure).unwrap(),
            serde_json::to_string(&unchanged_budget.structure).unwrap()
        );
        assert!((a.structure.metrics.allocated_area - 200_000.0).abs() < 50.0);
        for (i, phase) in a.phases.iter().enumerate() {
            for later in &a.phases[i + 1..] {
                for p in phase {
                    for q in later {
                        assert!(area(&g::intersection(p, q)) < 0.01);
                    }
                }
            }
        }
    }
    #[test]
    fn archipelago_retains_separate_nuclei_and_water_holes() {
        let (site, morph) = input();
        let h = vec![0.0; 128 * 128];
        let mut w = vec![0; h.len()];
        for y in 61..66 {
            for x in 61..66 {
                w[y * 128 + x] = 1;
            }
        }
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n: 128,
            height: &h,
            water: &w,
        };
        let cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "archipelago".into(),
                mechanism: "planned".into(),
                separation: 2.3,
                gross_density: 50.0,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        let a = generate("archipelago", &site, &cfg, &morph, surface, &[], 250.0);
        assert_eq!(a.structure.centers.len(), 3);
        assert!(a.structure.allocated.len() >= 3);
        assert!(a.structure.allocated.iter().any(|s| !s.holes.is_empty()));
        assert!(
            !a.structure
                .allocated
                .iter()
                .any(|s| g::contains(s, site.center))
        );
    }
    #[test]
    fn accessible_growth_does_not_cross_an_unbridged_river() {
        let (mut site, morph) = input();
        site.center.x = 1350.0;
        let h = vec![0.0; 128 * 128];
        let mut w = vec![0; h.len()];
        for y in 0..128 {
            for x in 62..65 {
                w[y * 128 + x] = 1;
            }
        }
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n: 128,
            height: &h,
            water: &w,
        };
        let cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "compact".into(),
                gross_density: 50.0,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        let a = generate("river", &site, &cfg, &morph, surface, &[], 250.0);
        assert!(
            a.structure
                .allocated
                .iter()
                .flat_map(|s| &s.outer)
                .all(|p| p.x <= 62.0 / 128.0 * 3000.0 + 1e-7)
        );
        assert!(
            (a.structure.metrics.allocated_area - a.structure.metrics.target_area).abs() < 2000.0
        );
    }

    #[test]
    fn accessible_growth_spans_a_river_through_an_existing_bridge() {
        let (mut site, morph) = input();
        site.center.x = 1350.0;
        site.population = 6000;
        let h = vec![0.0; 128 * 128];
        let mut w = vec![0; h.len()];
        for y in 0..128 {
            for x in 62..65 {
                w[y * 128 + x] = 1;
            }
        }
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n: 128,
            height: &h,
            water: &w,
        };
        let (west, east) = (62.0 / 128.0 * 3000.0, 65.0 / 128.0 * 3000.0);
        let road = |a: f64, b: f64, role: &str| Street {
            path: vec![Point { x: a, y: 1500.0 }, Point { x: b, y: 1500.0 }],
            widths: vec![8.0, 8.0],
            rank: 1,
            role: role.into(),
        };
        let roads = [
            road(200.0, west - 10.0, "regional"),
            road(west - 10.0, east + 10.0, "bridge"),
            road(east + 10.0, 2800.0, "regional"),
        ];
        // Compact growth, then the bench default where porous dispersion
        // keeps only the patches it can serve.
        for cohesion in [1.0, 0.85] {
            let cfg = LayoutConfig {
                footprint: FootprintConfig {
                    family: "compact".into(),
                    gross_density: 50.0,
                    cohesion,
                    ..FootprintConfig::default()
                },
                ..LayoutConfig::default()
            };
            let a = generate("river", &site, &cfg, &morph, surface, &roads, 250.0);
            let side = |east_bank: bool| {
                a.structure
                    .allocated
                    .iter()
                    .filter(|s| (g::centroid(s).x > east) == east_bank)
                    .map(g::area)
                    .sum::<f64>()
            };
            let target = a.structure.metrics.target_area;
            assert!(
                side(true) > target * 0.15,
                "east bank {:.0} m² of {target:.0}",
                side(true)
            );
            assert!(side(false) > target * 0.15);
            // Water is never allocated; only the bridge joins the banks.
            for s in &a.structure.allocated {
                assert!(
                    s.outer
                        .iter()
                        .all(|p| p.x <= west + 1e-6 || p.x >= east - 1e-6)
                );
            }
            assert!(a.structure.centers.iter().any(|c| c.point.x > east));
            assert!((a.structure.metrics.allocated_area - target).abs() < target * 0.05);
        }
    }

    #[test]
    fn town_builds_its_own_bridge_over_a_stream_but_not_over_a_wide_river() {
        // 5 m cells; a 15 m stream, then a 200 m river, east of a 5 000-inhabitant
        // town, with no regional crossing at all.
        let (mut site, morph) = input();
        site.center.x = 1350.0;
        site.population = 5000;
        let n = 600;
        let h = vec![0.0; n * n];
        let cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "compact".into(),
                gross_density: 50.0,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        for (cells, crossed) in [(3, true), (40, false)] {
            let mut w = vec![0; h.len()];
            for y in 0..n {
                for x in 300..300 + cells {
                    w[y * n + x] = 1;
                }
            }
            let surface = Surface {
                geometry: None,
                width: 3000.0,
                n,
                height: &h,
                water: &w,
            };
            let (west, east) = (1500.0, 1500.0 + cells as f64 * 5.0);
            let a = generate("stream", &site, &cfg, &morph, surface, &[], 250.0);
            let target = a.structure.metrics.target_area;
            let east_bank: f64 = a
                .structure
                .allocated
                .iter()
                .filter(|s| g::centroid(s).x > east)
                .map(g::area)
                .sum();
            let bridges: Vec<_> = a.links.iter().filter(|s| s.role == "bridge").collect();
            for s in &a.structure.allocated {
                assert!(
                    s.outer
                        .iter()
                        .all(|p| p.x <= west + 1e-6 || p.x >= east - 1e-6)
                );
            }
            if crossed {
                assert!(
                    east_bank > target * 0.15,
                    "east bank {east_bank:.0} of {target:.0} m²"
                );
                assert!(!bridges.is_empty(), "no urban bridge over the stream");
                for b in &bridges {
                    let (p, q) = (b.path[0], *b.path.last().unwrap());
                    // Abutment to abutment across the water, about perpendicular.
                    assert!(p.x.min(q.x) < west && p.x.max(q.x) > east);
                    assert!((p.y - q.y).abs() < (p.x - q.x).abs() * 0.6);
                    assert!(b.widths.iter().all(|&w| w >= 3.0));
                }
                assert!((a.structure.metrics.allocated_area - target).abs() < target * 0.05);
            } else {
                assert!(
                    east_bank == 0.0 && bridges.is_empty(),
                    "{east_bank:.0} m² beyond 200 m of water"
                );
            }
        }
    }

    #[test]
    fn finger_and_dendritic_families_have_distinct_geography_without_imported_roads() {
        let (site, morph) = input();
        let h = vec![0.0; 128 * 128];
        let w = vec![0; h.len()];
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n: 128,
            height: &h,
            water: &w,
        };
        let mut cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "fingers".into(),
                gross_density: 50.0,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        let fingers = generate("families", &site, &cfg, &morph, surface, &[], 250.0);
        cfg.footprint.family = "dendritic".into();
        let dendritic = generate("families", &site, &cfg, &morph, surface, &[], 250.0);
        let overlap: f64 = fingers
            .structure
            .allocated
            .iter()
            .flat_map(|a| {
                dendritic
                    .structure
                    .allocated
                    .iter()
                    .flat_map(move |b| g::intersection(a, b))
            })
            .map(|s| g::area(&s))
            .sum();
        // Compare geometry only: changing a family string cannot satisfy this.
        assert!(overlap < fingers.structure.metrics.allocated_area * 0.98);
        assert_eq!(fingers.guides.len(), 5);
        assert_eq!(dendritic.guides.len(), 7);
    }

    #[test]
    fn disconnected_nuclei_do_not_report_an_absorption_event() {
        let (site, morph) = input();
        let h = vec![0.0; 128 * 128];
        let w = vec![0; h.len()];
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n: 128,
            height: &h,
            water: &w,
        };
        let cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "archipelago".into(),
                separation: 2.3,
                gross_density: 50.0,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        let a = generate("history", &site, &cfg, &morph, surface, &[], 250.0);
        assert!(a.structure.allocated.len() >= 3);
        assert!(
            a.structure
                .history
                .iter()
                .all(|e| e.kind != "nucleus-merger")
        );
    }

    #[test]
    fn seeded_growth_contours_remove_lattice_stairs_instead_of_only_rounding_corners() {
        let grid = Grid {
            x0: 0.0,
            y0: 0.0,
            step: 10.0,
            nx: 64,
            ny: 64,
        };
        let noise = crate::noise::Noise::new(Rng::new("decor-70-smooth-growth"));
        let mask: Vec<_> = (0..grid.nx * grid.ny)
            .map(|i| {
                let p = grid.point(i);
                let radius = 170.0 + 12.0 * noise.noise(p.x / 90.0, p.y / 90.0);
                (p.x - 320.0).hypot((p.y - 320.0) * 1.3) < radius
            })
            .collect();
        let h = vec![0.0; 64 * 64];
        let w = vec![0; h.len()];
        let surface = Surface {
            geometry: None,
            width: 640.0,
            n: 64,
            height: &h,
            water: &w,
        };
        let raw = grid.contours(&mask);
        let anchors = grid.boundary_centers(&mask);
        let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
        assert_eq!(smooth.len(), 1);
        let ring = &smooth[0].outer;
        let mut axial = 0.0;
        let mut perimeter = 0.0;
        let mut max_turn = 0.0_f64;
        for i in 0..ring.len() {
            let a = ring[(i + ring.len() - 1) % ring.len()];
            let b = ring[i];
            let c = ring[(i + 1) % ring.len()];
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let (ex, ey) = (c.x - b.x, c.y - b.y);
            max_turn = max_turn.max((dx * ey - dy * ex).atan2(dx * ex + dy * ey).abs());
        }
        assert!(max_turn < 0.6, "abrupt raster corner: {} radians", max_turn);
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let length = distance(a, b);
            perimeter += length;
            if (a.x - b.x).abs().min((a.y - b.y).abs()) < length * 0.02 {
                axial += length;
            }
        }
        assert!(
            axial / perimeter < 0.25,
            "lattice-aligned perimeter: {}",
            axial / perimeter
        );
        assert!((area(&smooth) - area(&raw)).abs() < area(&raw) * 0.01);
        assert!(anchors.iter().all(|&p| g::contains(&smooth[0], p)));
        assert_eq!(
            serde_json::to_string(&smooth).unwrap(),
            serde_json::to_string(&smooth_growth(&raw, grid.step, surface, &anchors)).unwrap()
        );
    }

    #[test]
    fn small_growth_components_keep_their_area_without_restoring_lattice_steps() {
        let grid = Grid {
            x0: 0.0,
            y0: 0.0,
            step: 10.0,
            nx: 64,
            ny: 64,
        };
        let mask: Vec<_> = (0..grid.nx * grid.ny)
            .map(|i| {
                let p = grid.point(i);
                (p.x - 150.0).hypot((p.y - 150.0) * 1.3) < 65.0
                    || (p.x - 410.0).hypot((p.y - 410.0) * 1.3) < 80.0
            })
            .collect();
        let h = vec![0.0; 64 * 64];
        let w = vec![0; h.len()];
        let surface = Surface {
            geometry: None,
            width: 640.0,
            n: 64,
            height: &h,
            water: &w,
        };
        let raw = grid.contours(&mask);
        let anchors = grid.boundary_centers(&mask);
        let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
        assert_eq!(smooth.len(), 2);
        for shape in &smooth {
            let mut axial = 0.0;
            let mut perimeter = 0.0;
            for (&a, &b) in shape
                .outer
                .iter()
                .zip(shape.outer.iter().cycle().skip(1))
                .take(shape.outer.len())
            {
                let length = distance(a, b);
                perimeter += length;
                if (a.x - b.x).abs().min((a.y - b.y).abs()) < length * 0.02 {
                    axial += length;
                }
            }
            assert!(
                axial / perimeter < 0.25,
                "small district reverted to the lattice: {}",
                axial / perimeter
            );
        }
        assert!((area(&smooth) - area(&raw)).abs() < area(&raw) * 0.01);
        assert!(
            anchors
                .iter()
                .all(|&p| smooth.iter().any(|s| g::contains(s, p)))
        );
    }

    #[test]
    fn smoothing_retains_thin_branches_components_centers_and_exact_water_holes() {
        let grid = Grid {
            x0: 0.0,
            y0: 0.0,
            step: 10.0,
            nx: 64,
            ny: 64,
        };
        let mut mask = vec![false; grid.nx * grid.ny];
        for y in 0..grid.ny {
            for x in 0..grid.nx {
                let circle = (x as f64 - 24.0).hypot(y as f64 - 30.0) < 15.0;
                let neck_and_arm =
                    ((24..=57).contains(&x) && y == 30) || (x >= 53 && (25..=35).contains(&y));
                let island = (x as f64 - 8.0).hypot(y as f64 - 8.0) < 4.0;
                mask[y * grid.nx + x] = circle || neck_and_arm || island;
            }
        }
        let h = vec![0.0; 64 * 64];
        let mut w = vec![0; h.len()];
        for y in 27..=29 {
            for x in 22..=24 {
                w[y * 64 + x] = 1;
            }
        }
        let surface = Surface {
            geometry: None,
            width: 640.0,
            n: 64,
            height: &h,
            water: &w,
        };
        let raw = dry(surface, &grid.contours(&mask));
        let anchors = grid.boundary_centers(&mask);
        let smooth = smooth_growth(&raw, grid.step, surface, &anchors);
        assert_eq!(raw.len(), smooth.len());
        assert_eq!(
            raw.iter().map(|s| s.holes.len()).sum::<usize>(),
            smooth.iter().map(|s| s.holes.len()).sum::<usize>()
        );
        assert!((area(&smooth) - area(&raw)).abs() < area(&raw) * 0.01);
        for p in anchors
            .iter()
            .filter(|&&p| raw.iter().any(|s| g::contains(s, p)))
        {
            assert!(
                smooth.iter().any(|s| g::contains(s, *p)),
                "a one-cell arm was removed"
            );
        }
        assert!(
            !smooth
                .iter()
                .any(|s| g::contains(s, Point { x: 235.0, y: 285.0 }))
        );
        assert!(smooth.iter().all(|s| g::polygon(s).is_valid()));
        assert_ne!(
            serde_json::to_string(&raw).unwrap(),
            serde_json::to_string(&smooth).unwrap()
        );
        // Terrain clipping may leave a component smaller than the growth cell.
        let sliver = vec![g::rectangle(100.0, 100.0, 100.2, 100.3)];
        let retained = smooth_growth(&sliver, grid.step, surface, &[]);
        assert_eq!(retained.len(), 1);
        assert!((area(&retained) - area(&sliver)).abs() < 1.0e-6);
    }
}
