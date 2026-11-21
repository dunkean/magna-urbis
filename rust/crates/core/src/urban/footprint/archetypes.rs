//! Archetype selection, guide streets and planned vector foundations.
use super::geometry::{area, at, dry, subtract, union};
use super::site::{Geography, slope};
use crate::rng::Rng;
use crate::urban::{
    LayoutConfig, Point, Shape, Site, Street, Surface, UrbanCenter, geometry as g, profiles,
};
use std::f64::consts::{PI, TAU};

pub(super) fn geometric_foundation(site: &Site, cfg: &LayoutConfig) -> bool {
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
pub(super) fn compatible_foundation(geography: Geography, radius: f64) -> bool {
    geography.dry_fraction >= 0.88
        && geography.buildable_fraction >= 0.88
        && geography.slope_p90 <= 0.10
        && geography.relief <= radius * 0.18
}
pub(super) fn family<'a>(site: &Site, cfg: &'a LayoutConfig, geography: Geography, radius: f64) -> &'a str {
    if cfg.footprint.family != "auto" {
        return &cfg.footprint.family;
    }
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let p = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
    if cfg.regular_grid_outline && (p.pattern == "grid" || cfg.tissue == "grid") {
        "rectangle"
    } else if p.enclosure == "square"
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
pub(super) fn mechanism<'a>(cfg: &'a LayoutConfig, family: &str) -> &'a str {
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

pub(super) fn guides(family: &str, center: Point, radius: f64, angle: f64, rng: &Rng) -> Vec<Street> {
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

/// Fit a planned rectangle to buildable terrain. Its centre slides (up to 0.45 radius) and,
/// unless the plan is cardinal, it turns (up to 16°) to the position whose
/// rectangle is most buildable (dry, within the buildable grade); a small
/// cost per metre moved keeps it at its site when the land is even.
#[allow(clippy::too_many_arguments)]
pub(super) fn fit_rectangle(center: Point, target: f64, aspect: f64, angle: f64, cardinal: bool, grade: f64,
    radius: f64, surface: Surface<'_>) -> (Point, f64, f64, f64) {
    const K: usize = 14;
    // Steep land is lost to the plan; a river crossing it is a town's river
    // (water gates, quays), so water costs half.
    let score = |c: Point, a: f64, aspect: f64| {
        let (hx, hy) = ((target * aspect).sqrt() * 0.5, (target / aspect).sqrt() * 0.5);
        let mut bad = 0.0;
        for i in 0..K {
            for j in 0..K {
                let p = at(c, Point { x: hx * ((i as f64 + 0.5) / K as f64 * 2.0 - 1.0),
                    y: hy * ((j as f64 + 0.5) / K as f64 * 2.0 - 1.0) }, a);
                let (gx, gy) = slope(surface, p);
                bad += if surface.wet(p) { 0.5 } else if gx.hypot(gy) > grade { 1.0 } else { 0.0 };
            }
        }
        1.0 - bad / (K * K) as f64
    };
    let turns: &[f64] = if cardinal { &[0.0] } else { &[0.0, -0.14, 0.14, -0.28, 0.28] };
    let mut best = (score(center, angle, aspect), center, angle, aspect);
    if best.0 >= 0.92 { return (center, angle, best.0, aspect); }
    // A valley town stretches along its valley: the plan may lengthen (the
    // same area) as well as slide and turn.
    for (&t, &k) in turns.iter().flat_map(|t| [1.0, 1.5, 1.0 / 1.5, 2.0, 0.5].iter().map(move |k| (t, k))) {
        for i in -4..=4 {
            for j in -4..=4 {
                let c = Point { x: center.x + 0.45 * radius * i as f64 / 4.0, y: center.y + 0.45 * radius * j as f64 / 4.0 };
                if surface.wet(c) { continue; }
                let moved = (c.x - center.x).hypot(c.y - center.y) / radius;
                let v = score(c, angle + t, aspect * k) - 0.15 * moved - 0.05 * t.abs() - 0.03 * f64::ln(k).abs();
                if v > best.0 + 0.01 { best = (v, c, angle + t, aspect * k); }
            }
        }
    }
    (best.1, best.2, best.0, best.3)
}

pub(super) fn template(
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
pub(super) fn planned(
    target: f64,
    family: &str,
    cfg: &LayoutConfig,
    centers: &[UrbanCenter],
    angle: f64,
    secondary: Option<f64>,
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
            } else if c.id > 0 && let Some(a) = secondary {
                a
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
