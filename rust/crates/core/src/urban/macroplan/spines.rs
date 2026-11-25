//! Street spines shaped by the terrain and cultural plan.

use super::*;

/// Fit the local bank rather than pointing toward the first wet raster cell.
/// The fit smooths cell stair-steps without changing the authoritative water mask.
pub(super) fn water_angle(surface: Surface<'_>, center: Point, radius: f64) -> Option<f64> {
    let cell = surface.width / surface.n as f64;
    let reach = (radius * 1.5).max(cell * 4.0);
    let lo = |v: f64| ((v - reach) / cell).floor().max(0.0) as usize;
    let hi = |v: f64| (((v + reach) / cell).ceil() as usize).min(surface.n - 1);
    let mut banks = vec![];
    for y in lo(center.y)..=hi(center.y) {
        for x in lo(center.x)..=hi(center.x) {
            let wet = surface.water[y * surface.n + x] != 0;
            if x + 1 < surface.n && wet != (surface.water[y * surface.n + x + 1] != 0) {
                banks.push(Point {
                    x: (x + 1) as f64 * cell,
                    y: (y as f64 + 0.5) * cell,
                });
            }
            if y + 1 < surface.n && wet != (surface.water[(y + 1) * surface.n + x] != 0) {
                banks.push(Point {
                    x: (x as f64 + 0.5) * cell,
                    y: (y + 1) as f64 * cell,
                });
            }
        }
    }
    let anchor = *banks
        .iter()
        .min_by(|&&a, &&b| dist(a, center).total_cmp(&dist(b, center)))?;
    let window = (radius * 0.4).max(cell * 2.0);
    let mut weight = 0.0;
    let mut mean = Point { x: 0.0, y: 0.0 };
    let weighted: Vec<_> = banks
        .into_iter()
        .filter_map(|p| {
            let d = dist(p, anchor) / window;
            (d < 2.0).then_some((p, (1.0 + d * d).powi(-2)))
        })
        .collect();
    for &(p, w) in &weighted {
        weight += w;
        mean.x += p.x * w;
        mean.y += p.y * w;
    }
    if weight <= 0.0 || weighted.len() < 2 {
        return None;
    }
    mean.x /= weight;
    mean.y /= weight;
    let (mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0);
    for (p, w) in weighted {
        let x = p.x - mean.x;
        let y = p.y - mean.y;
        xx += w * x * x;
        xy += w * x * y;
        yy += w * y * y;
    }
    ((xx - yy).hypot(2.0 * xy) > 1e-8).then(|| 0.5 * (2.0 * xy).atan2(xx - yy))
}
pub(super) fn simple_path(path: &[Point], closed: bool) -> bool {
    let last = path.len().saturating_sub(2);
    for (i, a) in path.windows(2).enumerate() {
        for (j, b) in path.windows(2).enumerate().skip(i + 2) {
            if closed && i == 0 && j == last {
                continue;
            }
            if g::segment_hit(a[0], a[1], b[0], b[1]).is_some() {
                return false;
            }
        }
    }
    true
}
/// A connected pair of routed arms supplies radial growth without forcing a
/// straight wedge through a river or steep hill. Existing corridors stay first.
#[allow(clippy::too_many_arguments)]
pub(super) fn cultural_spines(
    regions: &mut Vec<Shape>,
    streets: &mut Vec<Street>,
    dry: &[Shape],
    planner: &mut routing::RoutePlanner<'_>,
    center: Point,
    angle: f64,
    radius: f64,
    cfg: &LayoutConfig,
    m: &Morph,
    radial: bool,
    cardinal: bool,
    rng: &mut Rng,
) {
    let Some(shape) = dry.iter().find(|s| g::contains(s, center)) else {
        return;
    };
    let nucleus = nearest(center, streets)
        .filter(|v| v.0 < radius * 0.25)
        .map(|v| v.1)
        .filter(|&p| g::contains(shape, p))
        .unwrap_or(center);
    let listed = |k: &str| {
        m.value["streets"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(k)))
    };
    let diameters = if radial {
        cfg.count.div_ceil(2).clamp(2, 8)
    } else {
        2
    };
    // Gate-to-gate spines (souk, bazaar) wander: two lateral sine waypoints
    // per arm, scaled by the cultural `spineAmp`, still routed on dry, graded land.
    let amplitude = if listed("gateToGate") {
        m.number("spineAmp") * (radius / 150.0).clamp(1.0, 4.0)
    } else {
        0.0
    };
    let wander = |from: Point, to: Point, planner: &mut routing::RoutePlanner<'_>, sign: f64| {
        let mut stops = vec![from];
        if amplitude > 0.0 {
            let (dx, dy) = (to.x - from.x, to.y - from.y);
            let l = dx.hypot(dy).max(1e-6);
            for (t, phase) in [(1.0 / 3.0, 1.0), (2.0 / 3.0, -0.6)] {
                let p = Point {
                    x: from.x + dx * t - dy / l * amplitude * phase * sign,
                    y: from.y + dy * t + dx / l * amplitude * phase * sign,
                };
                if g::contains(shape, p) {
                    stops.push(p);
                }
            }
        }
        stops.push(to);
        let mut path = vec![from];
        for w in stops.windows(2) {
            path.extend(
                planner
                    .route(w[0], w[1], cfg.max_street_grade)?
                    .into_iter()
                    .skip(1),
            );
        }
        Some(path)
    };
    for i in 0..diameters {
        let bearing = angle
            + i as f64 * PI / diameters as f64
            + if cardinal || !radial || i == 0 {
                0.0
            } else {
                rng.range(-0.1, 0.1)
            };
        let Some((a, b)) = chord(shape, nucleus, bearing) else {
            continue;
        };
        // Stay on the land side of exact map/water boundaries, within the
        // junction quantization used by the shared street graph.
        let a = point(a, nucleus, (1e-7 / dist(a, nucleus).max(0.03)).min(0.01));
        let b = point(b, nucleus, (1e-7 / dist(b, nucleus).max(0.03)).min(0.01));
        let inherited = |target: Point| {
            if cfg.axis_alignment != "regional" {
                return None;
            }
            let dx = target.x - nucleus.x;
            let dy = target.y - nucleus.y;
            let length = dx.hypot(dy).max(1e-6);
            streets
                .iter()
                .filter(|s| matches!(s.role.as_str(), "regional" | "bridge" | "ford" | "causeway"))
                .filter(|s| {
                    s.path
                        .windows(2)
                        .any(|p| g::distance(nucleus, p[0], p[1]).0 < 3.0)
                })
                .flat_map(|s| &s.path)
                .filter_map(|p| {
                    let x = p.x - nucleus.x;
                    let y = p.y - nucleus.y;
                    let d = x.hypot(y);
                    let cosine = (x * dx + y * dy) / (d * length).max(1e-6);
                    (d > radius * 0.15 && cosine > 0.85)
                        .then_some((y.atan2(x), (d - radius * 0.25).abs()))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|p| p.0)
        };
        let (inherited_a, inherited_b) = (inherited(a), inherited(b));
        let (old_a, old_b) = (inherited_a.is_some(), inherited_b.is_some());
        if old_a && old_b {
            continue;
        }
        let mut a = a;
        let mut b = b;
        if let Some(incoming) = inherited_a.or(inherited_b) {
            let direction = incoming + PI;
            if let Some((left, right)) = chord(shape, nucleus, direction) {
                let along = |p: Point| {
                    (p.x - nucleus.x) * direction.cos() + (p.y - nucleus.y) * direction.sin()
                };
                let target = if along(left) > along(right) {
                    left
                } else {
                    right
                };
                let target = point(
                    target,
                    nucleus,
                    (1e-7 / dist(target, nucleus).max(0.03)).min(0.01),
                );
                if old_a {
                    b = target;
                } else {
                    a = target;
                }
            }
        }
        let sign = if i % 2 == 0 { 1.0 } else { -1.0 };
        let path = if old_a {
            wander(nucleus, b, planner, sign)
        } else if old_b {
            wander(a, nucleus, planner, sign)
        } else {
            wander(a, nucleus, planner, sign).and_then(|mut path| {
                let tail = wander(nucleus, b, planner, -sign)?;
                path.extend(tail.into_iter().skip(1));
                Some(path)
            })
        };
        let Some(path) = path else {
            continue;
        };
        if !inside_path(shape, &path) || !simple_path(&path, false) {
            continue;
        }
        if path
            .iter()
            .all(|&p| nearest(p, streets).is_some_and(|n| n.0 < 2.0))
        {
            continue;
        }
        let width = if old_a || old_b {
            streets
                .iter()
                .filter(|s| s.role == "regional")
                .filter(|s| {
                    s.path
                        .windows(2)
                        .any(|p| g::distance(nucleus, p[0], p[1]).0 < 3.0)
                })
                .flat_map(|s| s.widths.iter().copied())
                .fold(0.0_f64, f64::max)
                .max(2.0)
        } else {
            m.width(if i == 0 { 0 } else { 1 }, rng)
        };
        let street = Street {
            widths: vec![width; path.len()],
            path,
            rank: usize::from(i > 0),
            role: if radial { "radial" } else { "street" }.into(),
        };
        split_by(regions, &street);
        streets.push(street);
    }
    if cfg.rings < 2 || !radial || streets.is_empty() {
        return;
    }
    let mut ring = vec![];
    for i in 0..24 {
        let a = angle + i as f64 * TAU / 24.0;
        let p = Point {
            x: nucleus.x + a.cos() * radius * 0.43,
            y: nucleus.y + a.sin() * radius * 0.43,
        };
        if !g::contains(shape, p) {
            return;
        }
        ring.push(p);
    }
    let mut path = vec![ring[0]];
    for i in 0..ring.len() {
        let Some(part) = planner.route(ring[i], ring[(i + 1) % ring.len()], cfg.max_street_grade)
        else {
            return;
        };
        path.extend(part.into_iter().skip(1));
    }
    if !inside_path(shape, &path) || !simple_path(&path, true) {
        return;
    }
    if !path.windows(2).any(|a| {
        streets.iter().any(|st| {
            st.path
                .windows(2)
                .any(|b| g::segment_hit(a[0], a[1], b[0], b[1]).is_some())
        })
    }) {
        return;
    }
    let inner = g::normalized(Shape {
        outer: path[..path.len() - 1].to_vec(),
        holes: vec![],
    });
    if g::area(&inner) < 100.0 {
        return;
    }
    let mut partition = vec![];
    for region in regions.iter() {
        partition.extend(g::intersection(region, &inner));
        partition.extend(g::difference(region, &inner));
    }
    let before: f64 = regions.iter().map(g::area).sum();
    let after: f64 = partition.iter().map(g::area).sum();
    if (before - after).abs() > before * 1e-6 + 0.01 {
        return;
    }
    *regions = partition;
    let width = m.width(1, rng);
    streets.push(Street {
        widths: vec![width; path.len()],
        path,
        rank: 1,
        role: "ring".into(),
    });
}
