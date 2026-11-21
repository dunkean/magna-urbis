//! Footprint-scale geography, plan orientation and the placement of nuclei.
use super::geometry::distance;
use crate::rng::Rng;
use crate::urban::{
    LayoutConfig, Point, Site, Street, Surface, UrbanCenter, geometry as g, macroplan, profiles,
    routing,
};
use std::f64::consts::{PI, TAU};

#[derive(Clone, Copy)]
pub(super) struct Geography {
    pub(super) dry_fraction: f64,
    pub(super) buildable_fraction: f64,
    pub(super) slope_p90: f64,
    pub(super) relief: f64,
    pub(super) contour_angle: f64,
}
pub(super) fn slope(surface: Surface<'_>, p: Point) -> (f64, f64) {
    let d = (surface.width / surface.height_resolution() as f64 * 0.45).max(1.0);
    (
        (surface.height_at(Point { x: p.x + d, y: p.y })
            - surface.height_at(Point { x: p.x - d, y: p.y }))
            / (2.0 * d),
        (surface.height_at(Point { x: p.x, y: p.y + d })
            - surface.height_at(Point { x: p.x, y: p.y - d }))
            / (2.0 * d),
    )
}
pub(super) fn buildable_grade(site: &Site, cfg: &LayoutConfig) -> f64 {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let profile = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs);
    let strict = if profile.stairs || profile.pattern == "terraces" {
        0.5
    } else {
        0.34
    };
    if (15..1000).contains(&site.population) {
        profiles::relaxed(strict, cfg.programme.slope_relax).min(1.5)
    } else {
        strict
    }
}
/// A footprint-scale survey catches a hilltop/col whose center gradient is zero.
/// Densities and foundation decisions use the same final physical terrain.
pub(super) fn geography(site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, radius: f64) -> Geography {
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

pub(in crate::urban) fn orientation(site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, roads: &[Street]) -> f64 {
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
        let step = (surface.width / surface.height_resolution() as f64).max(5.0);
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
        && !(cfg.regular_grid_outline && p.pattern == "grid" && p.orientation == "cardinal")
        && let Some(regional) = macroplan::regional_axis(
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

/// A hill nucleus moves only onto usable dry ground with a wheeled approach.
pub(super) fn summit_access(site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, roads: &[Street], radius: f64) -> Option<(Point, Option<Street>)> {
    if !cfg.power_high_ground || !matches!(cfg.site_archetype.as_str(), "hilltop" | "spur") {
        return None;
    }
    let reach = radius * 0.75;
    let step = (surface.width / surface.height_resolution() as f64 * 0.5).max(reach / 24.0).max(2.0);
    let count = (reach / step).ceil() as i32;
    let mut candidates = vec![site.center];
    for y in -count..=count {
        for x in -count..=count {
            if (x * x + y * y) as f64 * step * step > reach * reach { continue; }
            candidates.push(Point { x: site.center.x + x as f64 * step, y: site.center.y + y as f64 * step });
        }
    }
    candidates.retain(|&p| !surface.wet(p) && { let (x, y) = slope(surface, p); x.hypot(y) <= cfg.max_lane_grade });
    candidates.sort_by(|&a, &b| surface.height_at(b).total_cmp(&surface.height_at(a))
        .then_with(|| distance(a, site.center).total_cmp(&distance(b, site.center))));
    let summit = *candidates.first()?;
    let start = roads.iter().filter(|s| !matches!(s.role.as_str(), "bridge" | "ford" | "causeway"))
        .flat_map(|s| s.path.windows(2)).map(|w| g::distance(summit, w[0], w[1]))
        .filter(|(d, _, p)| *d <= radius * 2.0 && !surface.wet(*p))
        .min_by(|a, b| a.0.total_cmp(&b.0)).map_or(site.center, |(_, _, p)| p);
    if distance(start, summit) < 0.5 { return Some((summit, None)); }
    let margin = radius.max(100.0);
    let mut planner = routing::RoutePlanner::new(surface, (start.x.min(summit.x) - margin, start.y.min(summit.y) - margin,
        start.x.max(summit.x) + margin, start.y.max(summit.y) + margin));
    let path = planner.route(start, summit, cfg.max_street_grade)?;
    Some((summit, Some(Street { widths: vec![5.0; path.len()], path, rank: 1, role: "street".into() })))
}
#[allow(clippy::too_many_arguments)]
pub(super) fn centers(
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
        let point = if i == 0 && cfg.fixed_sites.contains(&site.key) { Some(p) } else { dry_center(p, radius, surface) };
        if let Some(p) = point
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

/// Underdark: the open share of the ground within `window` of `center` (24 x 24 samples),
/// or `None` where no cave rock is in that window (every ordinary map).
pub(super) fn cave_floor_share(surface: Surface<'_>, center: Point, window: f64) -> Option<f64> {
    const K: usize = 24;
    let at = |a: usize, b: usize| Point {
        x: center.x + window * (2.0 * (a as f64 + 0.5) / K as f64 - 1.0),
        y: center.y + window * (2.0 * (b as f64 + 0.5) / K as f64 - 1.0),
    };
    let inside = |p: Point| p.x >= 0.0 && p.y >= 0.0 && p.x < surface.width && p.y < surface.width;
    let points: Vec<Point> = (0..K * K).map(|i| at(i % K, i / K)).filter(|&p| inside(p)).collect();
    if !points.iter().any(|&p| surface.solid(p)) {
        return None;
    }
    Some(points.iter().filter(|&&p| !surface.wet(p)).count() as f64 / points.len().max(1) as f64)
}
