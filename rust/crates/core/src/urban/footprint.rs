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

pub(super) struct Footprint {
    pub structure: UrbanStructure,
    /// Chronological, disjoint attributed land. Earlier boundaries survive.
    pub phases: Vec<Vec<Shape>>,
    pub radius: f64,
    pub warnings: Vec<String>,
    /// Intended corridors are routed by the armature stage before acceptance.
    pub guides: Vec<Street>,
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

/// Population density is gross inhabitants/hectare. Domain reservations and
/// streets are already included; they are not added to the budget a second time.
fn budget(site: &Site, cfg: &LayoutConfig, morph: &Morph, radius: f64) -> (f64, f64) {
    let zone = if site.population < 1200 {
        "village"
    } else {
        "core"
    };
    let density = if cfg.footprint.gross_density > 0.0 {
        cfg.footprint.gross_density
    } else {
        morph.value["density"][zone].as_f64().unwrap_or(60.0) * cfg.density
    }
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
    epochs: usize,
    surface: Surface<'_>,
    rng: &Rng,
) -> (Vec<Shape>, Vec<Vec<Shape>>) {
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
    for epoch in 0..epochs {
        let fraction = (epoch + 1) as f64 / epochs as f64;
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
    let mut candidates = vec![];
    for original in shapes {
        let outline = g::normalized(Shape {
            outer: ring(&original.outer, step),
            holes: original.holes.clone(),
        });
        if outline.outer.len() < 3 || !g::polygon(&outline).is_valid() {
            candidates.push(original.clone());
            continue;
        }
        let clipped = g::dry_clip(&surface, &outline);
        if clipped.len() != 1
            || clipped[0].holes.len() != original.holes.len()
            || !g::polygon(&clipped[0]).is_valid()
        {
            candidates.push(original.clone());
            continue;
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
        let perimeter: f64 = original
            .outer
            .iter()
            .zip(original.outer.iter().cycle().skip(1))
            .take(original.outer.len())
            .map(|(&a, &b)| distance(a, b))
            .sum();
        let accepted = changed_area <= (perimeter * step * 0.6).min(original_area * 0.08) + 0.001
            && (g::area(candidate) - original_area).abs() <= original_area * 0.01 + 0.001
            && g::contains(candidate, g::interior_point(original))
            && protected.into_iter().all(|p| g::contains(candidate, p));
        candidates.push(if accepted {
            candidate.clone()
        } else {
            original.clone()
        });
    }
    let merged = union(&candidates);
    let original_holes: usize = shapes.iter().map(|s| s.holes.len()).sum();
    let merged_holes: usize = merged.iter().map(|s| s.holes.len()).sum();
    if merged.len() == shapes.len()
        && merged_holes == original_holes
        && geo::MultiPolygon(merged.iter().map(g::polygon).collect()).is_valid()
    {
        merged
    } else {
        shapes.to_vec()
    }
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

#[allow(clippy::too_many_arguments)]
fn accessible(
    target: f64,
    family: &str,
    cfg: &LayoutConfig,
    centers: &mut Vec<UrbanCenter>,
    radius: f64,
    angle: f64,
    epochs: usize,
    surface: Surface<'_>,
    roads: &[Street],
    rng: &Rng,
    grade_limit: f64,
    water_affinity: f64,
) -> (Vec<Shape>, Vec<Vec<Shape>>) {
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
        let road_attraction = if family == "linear" {
            0.95
        } else if matches!(family, "fingers" | "dendritic") {
            0.8
        } else {
            0.55
        };
        let attraction = 1.0
            - cfg.footprint.anisotropy * road_attraction * (-rd / (radius * 0.07).max(step)).exp();
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
        costs[i] = attraction * resource * variation * terrain * terminal;
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
            if arrivals[i] > 0.0 {
                arrivals[i] = 0.0;
                heap.push(Arrival { cost: 0.0, cell: i });
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
    while let Some(Arrival { cost, cell }) = heap.pop() {
        if cost > arrivals[cell] + 1e-9 || finalized[cell] {
            continue;
        }
        finalized[cell] = true;
        let connection = if parents[cell] == usize::MAX {
            vec![cell]
        } else {
            grid.move_cells(parents[cell], cell, &costs)
        };
        for i in connection {
            if !selected[i] {
                selected[i] = true;
                order.push(i);
            }
        }
        if order.len() >= budget {
            break;
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
            if !routing::segment_clear(surface, p, q, grade_limit * 1.3) {
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
                heap.push(Arrival {
                    cost: next_cost,
                    cell: next,
                });
            }
        }
    }
    let reserve = vec![g::rectangle(x0, y0, x1, y1)];
    let land = |mask: &[bool]| {
        dry(surface, &grid.contours(mask))
            .into_iter()
            .filter(|s| centers.iter().any(|c| g::contains(s, c.point)))
            .collect::<Vec<_>>()
    };
    let mut final_mask = vec![false; n];
    for &i in &order {
        final_mask[i] = true;
    }
    let mut anchors = grid.boundary_centers(&final_mask);
    anchors.extend(centers.iter().map(|c| c.point));
    let final_land = smooth_growth(&land(&final_mask), step, surface, &anchors);
    let mut phases = vec![];
    let mut previous: Vec<Shape> = vec![];
    for epoch in 0..epochs {
        let take = order.len() * (epoch + 1) / epochs;
        let mut mask = vec![false; n];
        for &i in &order[..take] {
            mask[i] = true;
        }
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
    (reserve, phases)
}

#[allow(clippy::too_many_arguments)]
fn ribbon(
    target: f64,
    cfg: &LayoutConfig,
    centers: &[UrbanCenter],
    radius: f64,
    angle: f64,
    epochs: usize,
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
    for epoch in 0..epochs {
        let grown = union(
            &[
                previous.clone(),
                dry(surface, &make(width * (epoch + 1) as f64 / epochs as f64)),
            ]
            .concat(),
        );
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
    let (target, density) = budget(site, cfg, morph, radius);
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
    let mut guides = centers
        .first()
        .map(|c| guides(family, c.point, radius, angle, &rng))
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
    let (reserve, mut phases) = if centers.is_empty() {
        (vec![], vec![vec![]; epochs])
    } else if mechanism == "planned" {
        planned(
            target,
            family,
            &foundation_cfg,
            &centers,
            angle,
            epochs,
            surface,
            &rng,
        )
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
            epochs,
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
        (r, p)
    } else {
        accessible(
            target,
            family,
            cfg,
            &mut centers,
            radius,
            angle,
            epochs,
            surface,
            &growth_roads,
            &rng,
            if cfg.tissue == "terraces" {
                0.5
            } else {
                buildable_grade(site, cfg)
            },
            morph.value["growth"]["water"].as_f64().unwrap_or(0.3),
        )
    };
    let allocated = union(&phases.iter().flatten().cloned().collect::<Vec<_>>());
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
        guides = self::guides(family, centers[0].point, radius, angle, &rng);
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
        },
    };
    Footprint {
        structure,
        phases,
        radius,
        warnings,
        guides,
    }
}

#[cfg(test)]
mod tests {
    use super::super::{FootprintConfig, resolve};
    use super::*;

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
