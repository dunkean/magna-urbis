//! Optional porous growth. Travel remains possible through unoccupied land;
//! only terrain-routed, substantial components survive as new neighbourhoods.
use super::*;

pub(super) fn enabled(cfg: &LayoutConfig) -> bool {
    let f = &cfg.footprint;
    f.cohesion < 1.0 || f.satellites > 0.0 || f.branch_depth > 0.0
}

/// Cohesion controls open-space frequency, gap_size its physical wavelength.
/// Preserve a dense core; steeper peripheral land is more likely to stay open.
#[allow(clippy::too_many_arguments)]
pub(super) fn occupied(
    cfg: &LayoutConfig,
    noise: &crate::noise::Noise,
    p: Point,
    radius: f64,
    step: f64,
    center_distance: f64,
    grade_ratio: f64,
) -> bool {
    if cfg.footprint.cohesion == 1.0 {
        return true;
    }
    let edge = ((center_distance / radius - 0.3) / 0.7).clamp(0.0, 1.0);
    let scale = cfg.footprint.gap_size.max(step * 3.0);
    let field = noise.noise(p.x / scale, p.y / scale)
        + 0.3 * noise.noise(p.x / (scale * 2.7) + 31.0, p.y / (scale * 2.7) - 17.0);
    let threshold = 0.65 - 0.85 * (1.0 - cfg.footprint.cohesion);
    field + grade_ratio * 0.18 <= threshold + (1.0 - edge) * 1.1
}

/// Avoid pinholes below the resolved open-space scale. Terrain exclusions and
/// open cuts touching them are never filled by this occupancy-only operation.
pub(super) fn resolve_gaps(mask: &mut [bool], dry: &[bool], grid: &Grid, gap_size: f64) {
    let mut visited = vec![false; mask.len()];
    let minimum = ((gap_size * 0.5 / grid.step).powi(2)).max(3.0);
    for root in 0..mask.len() {
        if mask[root] || !dry[root] || visited[root] {
            continue;
        }
        visited[root] = true;
        let mut patch = vec![root];
        let mut cursor = 0;
        let mut open = false;
        while cursor < patch.len() {
            let i = patch[cursor];
            cursor += 1;
            let (x, y) = (i % grid.nx, i / grid.nx);
            for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let (nx, ny) = (x as isize + dx, y as isize + dy);
                if nx < 0 || ny < 0 || nx >= grid.nx as isize || ny >= grid.ny as isize {
                    open = true;
                    continue;
                }
                let j = ny as usize * grid.nx + nx as usize;
                if !dry[j] {
                    open = true;
                }
                if dry[j] && !mask[j] && !visited[j] {
                    visited[j] = true;
                    patch.push(j);
                }
            }
        }
        if !open && (patch.len() as f64) < minimum {
            for i in patch {
                mask[i] = true;
            }
        }
    }
}

fn route(
    planner: &mut routing::RoutePlanner<'_>,
    cfg: &LayoutConfig,
    from: Point,
    to: Point,
) -> Option<Street> {
    for (grade, role, width) in [
        (cfg.max_street_grade, "approach", 3.0),
        (cfg.max_stair_grade, "stairs", 2.0),
    ] {
        if role == "stairs" && !cfg.allow_stairs {
            break;
        }
        if let Some(path) = planner.route(from, to, grade) {
            return Some(Street {
                widths: vec![width; path.len()],
                path,
                rank: 2,
                role: role.into(),
            });
        }
    }
    None
}

/// Candidate centres compete on ground slope, proximity to existing access and
/// separation. Try only a bounded number of the best sites, never invent bridges.
#[allow(clippy::too_many_arguments)]
pub(super) fn satellites(
    centers: &mut Vec<UrbanCenter>,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
    grade_limit: f64,
    rng: &Rng,
) {
    if centers.is_empty() || cfg.footprint.satellites == 0.0 {
        return;
    }
    let mut random = rng.fork("satellite-sites");
    let desired = cfg.footprint.satellites * 3.0;
    let count = desired.floor() as usize + usize::from(random.chance(desired.fract()));
    let origin = centers[0].point;
    let reach = radius * 3.5;
    let mut planner = routing::RoutePlanner::new(
        surface,
        (
            (origin.x - reach).max(0.0),
            (origin.y - reach).max(0.0),
            (origin.x + reach).min(surface.width),
            (origin.y + reach).min(surface.width),
        ),
    );
    for _ in 0..count.min(6 - centers.len().min(6)) {
        let mut candidates = vec![];
        for i in 0..48 {
            let a = i as f64 * TAU / 48.0 + random.range(-0.04, 0.04);
            // A satellite must be beyond the ordinary core, especially where
            // a narrow valley already stretches that core along its floor.
            let d = radius
                * random.range(
                    1.65 + cfg.footprint.satellites * 0.6,
                    2.25 + cfg.footprint.satellites,
                );
            let p = Point {
                x: origin.x + d * a.cos(),
                y: origin.y + d * a.sin(),
            };
            if p.x < 1.0
                || p.y < 1.0
                || p.x >= surface.width - 1.0
                || p.y >= surface.width - 1.0
                || surface.wet(p)
                || centers.iter().any(|c| distance(c.point, p) < radius * 0.9)
            {
                continue;
            }
            let (gx, gy) = slope(surface, p);
            let grade = gx.hypot(gy);
            if grade > grade_limit * 0.7 {
                continue;
            }
            let access = roads
                .iter()
                .flat_map(|s| s.path.windows(2))
                .map(|w| g::distance(p, w[0], w[1]).0)
                .fold(radius, f64::min);
            let score = grade / grade_limit * 2.0 + access / radius * 0.4 + random.range(0.0, 0.15);
            candidates.push((score, p));
        }
        candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
        for (_, p) in candidates.into_iter().take(6) {
            let from = centers
                .iter()
                .min_by(|a, b| distance(a.point, p).total_cmp(&distance(b.point, p)))
                .unwrap()
                .point;
            // A satellite is a cart-served hamlet, never a summit patch reached
            // only by stairs: its access must hold street grade.
            if planner.route(from, p, cfg.max_street_grade).is_some() {
                centers.push(UrbanCenter {
                    id: centers.len(),
                    point: p,
                    weight: centers[0].weight * (0.15 + cfg.footprint.satellites * 0.5),
                });
                break;
            }
        }
    }
    let total: f64 = centers.iter().map(|c| c.weight).sum();
    for c in centers {
        c.weight /= total;
    }
}

/// Keep a small number of useful patches and preserve a real access across the
/// gaps. The connecting path is infrastructure, not additional occupied land.
pub(super) fn serve(
    phases: &mut [Vec<Shape>],
    centers: &[UrbanCenter],
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    radius: f64,
    target: f64,
    roads: &[Street],
) -> Vec<Street> {
    let mut domains = union(&phases.iter().flatten().cloned().collect::<Vec<_>>());
    if domains.len() < 2 || centers.is_empty() {
        return vec![];
    }
    // Banks joined by an existing regional crossing are served by it, like
    // the growth that reached them; dry links are only routed on land.
    let reach = (radius * 0.1).max(60.0);
    let near = |s: &Shape, p: Point| {
        g::contains(s, p)
            || s.outer
                .iter()
                .zip(s.outer.iter().cycle().skip(1))
                .any(|(&a, &b)| g::distance(p, a, b).0 <= reach)
    };
    let spans = roads
        .iter()
        .filter(|r| matches!(r.role.as_str(), "bridge" | "ford" | "causeway"))
        .filter_map(|r| Some((*r.path.first()?, *r.path.last()?)))
        .collect::<Vec<_>>();
    let bridged = |kept: &[Shape], s: &Shape| {
        spans.iter().any(|&(a, b)| {
            (near(s, a) && kept.iter().any(|k| near(k, b)))
                || (near(s, b) && kept.iter().any(|k| near(k, a)))
        })
    };
    let origin = centers[0].point;
    domains.sort_by(|a, b| {
        g::contains(b, origin)
            .cmp(&g::contains(a, origin))
            .then_with(|| g::area(b).total_cmp(&g::area(a)))
    });
    let bounds = domains.iter().map(g::bbox).fold(
        (origin.x, origin.y, origin.x, origin.y),
        |(x0, y0, x1, y1), (a, b, c, d)| (x0.min(a), y0.min(b), x1.max(c), y1.max(d)),
    );
    let margin = radius * 0.5;
    let mut planner = routing::RoutePlanner::new(
        surface,
        (
            (bounds.0 - margin).max(0.0),
            (bounds.1 - margin).max(0.0),
            (bounds.2 + margin).min(surface.width),
            (bounds.3 + margin).min(surface.width),
        ),
    );
    let mut kept: Vec<Shape> = vec![];
    let mut anchors: Vec<Point> = vec![];
    let mut links: Vec<Street> = vec![];
    // A bank may only become reachable once the island before it is kept.
    let mut deferred = vec![];
    for domain in domains {
        let nucleus = centers.iter().find(|c| g::contains(&domain, c.point));
        if !kept.is_empty() && (g::area(&domain) < (target * 0.01).max(1000.0) || kept.len() >= 12)
        {
            continue;
        }
        if !kept.is_empty() && bridged(&kept, &domain) {
            anchors.push(g::interior_point(&domain));
            kept.push(domain);
            continue;
        }
        let p = nucleus.map_or_else(|| g::interior_point(&domain), |c| c.point);
        let mut targets: Vec<Point> = anchors.clone();
        // Reuse an existing trunk rather than drawing parallel paths to the core.
        for link in &links {
            if let Some((_, q)) = link
                .path
                .windows(2)
                .map(|w| {
                    let (d, _, q) = g::distance(p, w[0], w[1]);
                    (d, q)
                })
                .min_by(|a, b| a.0.total_cmp(&b.0))
            {
                targets.push(q);
            }
        }
        targets.sort_by(|a, b| distance(*a, p).total_cmp(&distance(*b, p)));
        let connection = targets
            .into_iter()
            .take(4)
            .find_map(|q| route(&mut planner, cfg, q, p));
        if let Some(link) = connection {
            links.push(link);
        } else if !anchors.is_empty() && nucleus.is_none() {
            deferred.push(domain);
            continue;
        }
        // Explicit original nuclei may be separated by water; preserve them
        // without fabricating a dry-land crossing.
        anchors.push(p);
        kept.push(domain);
    }
    while let Some(i) = deferred
        .iter()
        .position(|d| kept.len() < 12 && bridged(&kept, d))
    {
        let domain = deferred.swap_remove(i);
        anchors.push(g::interior_point(&domain));
        kept.push(domain);
    }
    for phase in phases {
        *phase = phase
            .iter()
            .flat_map(|s| kept.iter().flat_map(move |k| g::intersection(s, k)))
            .collect();
    }
    links
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_crosses_open_land_without_assigning_it() {
        let height = vec![0.0; 64 * 64];
        let water = vec![0; height.len()];
        let surface = Surface {
            geometry: None,
            width: 640.0,
            n: 64,
            height: &height,
            water: &water,
        };
        let centers = vec![UrbanCenter {
            id: 0,
            point: Point { x: 120.0, y: 300.0 },
            weight: 1.0,
        }];
        let mut phases = vec![vec![
            g::rectangle(60.0, 240.0, 180.0, 360.0),
            g::rectangle(340.0, 260.0, 420.0, 340.0),
        ]];
        let links = serve(
            &mut phases,
            &centers,
            &LayoutConfig::default(),
            surface,
            120.0,
            20800.0,
            &[],
        );
        assert_eq!(phases[0].len(), 2);
        assert_eq!(links.len(), 1);
        assert!(routing::path_clear(surface, &links[0].path, 0.18));
        assert!(
            !phases[0]
                .iter()
                .any(|s| g::contains(s, Point { x: 260.0, y: 300.0 }))
        );
        assert!((area(&phases[0]) - 20800.0).abs() < 1e-6);
        let replay = serve(
            &mut phases,
            &centers,
            &LayoutConfig::default(),
            surface,
            120.0,
            20800.0,
            &[],
        );
        assert_eq!(
            serde_json::to_string(&links).unwrap(),
            serde_json::to_string(&replay).unwrap()
        );
    }

    #[test]
    fn unserved_patch_across_water_is_not_invented_as_a_neighbourhood() {
        let height = vec![0.0; 64 * 64];
        let water: Vec<u8> = (0..height.len())
            .map(|i| u8::from((24..32).contains(&(i % 64))))
            .collect();
        let surface = Surface {
            geometry: None,
            width: 640.0,
            n: 64,
            height: &height,
            water: &water,
        };
        let centers = vec![UrbanCenter {
            id: 0,
            point: Point { x: 120.0, y: 300.0 },
            weight: 1.0,
        }];
        let mut phases = vec![vec![
            g::rectangle(60.0, 240.0, 180.0, 360.0),
            g::rectangle(340.0, 260.0, 420.0, 340.0),
        ]];
        assert!(
            serve(
                &mut phases,
                &centers,
                &LayoutConfig::default(),
                surface,
                120.0,
                20800.0,
                &[],
            )
            .is_empty()
        );
        assert_eq!(phases[0].len(), 1);
        assert!(g::contains(&phases[0][0], centers[0].point));
    }

    #[test]
    fn patch_across_an_existing_bridge_is_served_by_that_bridge() {
        let height = vec![0.0; 64 * 64];
        let water: Vec<u8> = (0..height.len())
            .map(|i| u8::from((24..32).contains(&(i % 64))))
            .collect();
        let surface = Surface {
            geometry: None,
            width: 640.0,
            n: 64,
            height: &height,
            water: &water,
        };
        let centers = vec![UrbanCenter {
            id: 0,
            point: Point { x: 120.0, y: 300.0 },
            weight: 1.0,
        }];
        let mut phases = vec![vec![
            g::rectangle(60.0, 240.0, 230.0, 360.0),
            g::rectangle(330.0, 260.0, 420.0, 340.0),
        ]];
        let bridge = Street {
            path: vec![Point { x: 232.0, y: 300.0 }, Point { x: 328.0, y: 300.0 }],
            widths: vec![6.0, 6.0],
            rank: 1,
            role: "bridge".into(),
        };
        let links = serve(
            &mut phases,
            &centers,
            &LayoutConfig::default(),
            surface,
            120.0,
            20800.0,
            &[bridge],
        );
        // The bridge itself serves the far bank: no dry link is invented.
        assert!(links.is_empty());
        assert_eq!(phases[0].len(), 2);
        assert!(
            phases[0]
                .iter()
                .any(|s| g::contains(s, Point { x: 380.0, y: 300.0 }))
        );
    }
}
