//! Bounded local co-generation: add access only where a block's land exceeds
//! the cultural frontage depth. Final cadastral cuts still operate on the retained layout.
use super::{Block, Layout, LayoutConfig, Morph, Point, Shape, Street, Surface, UrbanDistrict};
use super::{geometry as g, network, parcels, routing};
use std::collections::BTreeMap;

fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}
fn land_distance(p: Point, fronts: &[(Point, Point, usize)]) -> f64 {
    fronts
        .iter()
        .map(|&(a, b, _)| g::distance(p, a, b).0)
        .fold(f64::INFINITY, f64::min)
}
fn samples(s: &Shape) -> Vec<Point> {
    let (x0, y0, x1, y1) = g::bbox(s);
    let mut ps = vec![g::interior_point(s)];
    for y in 1..8 {
        for x in 1..8 {
            let p = Point {
                x: x0 + (x1 - x0) * x as f64 / 8.0,
                y: y0 + (y1 - y0) * y as f64 / 8.0,
            };
            if g::contains(s, p) {
                ps.push(p);
            }
        }
    }
    ps
}

pub(super) fn refine(layout: &mut Layout, cfg: &LayoutConfig, morph: &Morph, surface: Surface<'_>) {
    if cfg.access_mode != "adaptive" || cfg.access_budget == 0 {
        return;
    }
    let mut added = 0;
    // Stair lanes only for cultures that build stairs (same rule as the plan).
    let stairs = super::profiles::stairs_allowed(cfg, &layout.culture);
    let phase_morphs = layout
        .phases
        .iter()
        .map(|p| {
            super::composition::phase_morph(
                &layout.culture,
                &p.recipe,
                &p.zone,
                &cfg.preset,
                &cfg.recipe,
                cfg.density,
                &cfg.params,
                "quarters",
            )
            .map(|m| super::with_tissue(m, &cfg.tissue))
        })
        .collect::<Result<Vec<_>, _>>()
        .unwrap_or_default();
    let mut result = vec![];
    let original = std::mem::take(&mut layout.blocks);
    let neighbors = original
        .iter()
        .map(|b| (b.shape.clone(), g::bbox(&b.shape)))
        .collect::<Vec<_>>();
    let mut index = parcels::FrontageIndex::new(layout);
    for (block_id, block) in original.into_iter().enumerate() {
        let morph = block
            .phase
            .or_else(|| layout.quarters.get(block.quarter).map(|q| q.phase))
            .and_then(|i| phase_morphs.get(i))
            .unwrap_or(morph);
        if block.kind != "block" || g::area(&block.shape) < 600.0 || added >= 96 {
            result.push(block);
            continue;
        }
        let depth = if cfg.access_depth > 0.0 {
            cfg.access_depth
        } else {
            morph.range("plotDepth", &block.zone)[1].max(18.0)
        };
        let initial_fronts = parcels::access_fronts(&block.shape, layout, &index);
        if initial_fronts.is_empty() {
            result.push(block);
            continue;
        }
        let mut domains = vec![block.shape.clone()];
        let mut common = None;
        // A cluster is an actual shared court, not merely an organic street label.
        if cfg.tissue == "clusters" && g::area(&block.shape) > 1600.0 {
            let c = g::interior_point(&block.shape);
            let h = (g::area(&block.shape).sqrt() * 0.08).clamp(4.0, 12.0);
            let candidate = g::rectangle(c.x - h, c.y - h, c.x + h, c.y + h);
            if g::difference(&candidate, &block.shape)
                .iter()
                .map(g::area)
                .sum::<f64>()
                < 0.01
            {
                common = Some(candidate);
            }
        }
        let mut block_added = 0;
        for _ in 0..cfg.access_budget {
            if added >= 96 {
                break;
            }
            let mut targets = vec![];
            for (di, s) in domains.iter().enumerate() {
                let fronts = parcels::access_fronts(s, layout, &index);
                if fronts.is_empty() {
                    continue;
                }
                for p in samples(s) {
                    let d = land_distance(p, &fronts);
                    if d > depth * 1.08 {
                        targets.push((d, di, p, fronts.clone()));
                    }
                }
            }
            targets.sort_by(|a, b| b.0.total_cmp(&a.0));
            let forced_common = if block_added == 0 {
                common.as_ref().map(g::interior_point)
            } else {
                None
            };
            if let Some(c) = forced_common {
                targets.insert(0, (depth * 2.0, 0, c, initial_fronts.clone()));
            }
            let mut accepted = None;
            for (_, di, target, fronts) in targets.into_iter().take(4) {
                let shape = &domains[di];
                let mut candidates = fronts
                    .iter()
                    .map(|&(a, b, si)| {
                        let (_, t, p) = g::distance(target, a, b);
                        (dist(p, target), a, b, si, t.clamp(0.12, 0.88))
                    })
                    .collect::<Vec<_>>();
                candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
                for (_, a, b, si, t) in candidates.into_iter().take(4) {
                    let border = lerp(a, b, t);
                    let parent = &layout.streets[si];
                    let Some(start) = parent
                        .path
                        .windows(2)
                        .map(|w| g::distance(border, w[0], w[1]))
                        .min_by(|a, b| a.0.total_cmp(&b.0))
                        .map(|v| v.2)
                    else {
                        continue;
                    };
                    let l = dist(a, b).max(0.01);
                    let inner = Point {
                        x: border.x - (b.y - a.y) / l * 0.15,
                        y: border.y + (b.x - a.x) / l * 0.15,
                    };
                    if !g::contains(shape, inner) {
                        continue;
                    }
                    let end = if forced_common.is_some() {
                        target
                    } else {
                        lerp(inner, target, 0.92)
                    };
                    if dist(start, end) < 12.0 {
                        continue;
                    }
                    let mut path = if g::segment_within(shape, inner, end) {
                        vec![inner, end]
                    } else {
                        let mut router = routing::RoutePlanner::new(surface, g::bbox(shape));
                        let Some(path) = router.route_within(inner, end, cfg.max_lane_grade, shape)
                        else {
                            continue;
                        };
                        if !path
                            .windows(2)
                            .all(|w| g::segment_within(shape, w[0], w[1]))
                        {
                            continue;
                        }
                        path
                    };
                    path.insert(0, start);
                    let mut role = if matches!(morph.text("closeOp"), "derbs" | "roji" | "hutong") {
                        "private"
                    } else {
                        "collective"
                    };
                    if !routing::path_clear(surface, &path, cfg.max_lane_grade) {
                        if stairs && routing::path_clear(surface, &path, cfg.max_stair_grade) {
                            role = "stairs";
                        } else {
                            continue;
                        }
                    }
                    let base = if role == "stairs" { 2.0 } else { 2.6 };
                    let mut widths = vec![base; path.len()];
                    if role != "stairs" {
                        let mouth = parent
                            .widths
                            .iter()
                            .copied()
                            .fold(base, f64::max)
                            .min(base * 1.5);
                        let mut along = 0.0;
                        for i in 0..path.len() {
                            if i > 0 {
                                along += dist(path[i - 1], path[i]);
                            }
                            let t = (1.0 - along / 12.0).clamp(0.0, 1.0);
                            widths[i] = base + (mouth - base) * t * t * (3.0 - 2.0 * t);
                        }
                    }
                    let ribbons = g::ribbon(&path, &widths);
                    if ribbons.iter().any(|r| {
                        let bb = g::bbox(r);
                        neighbors.iter().enumerate().any(|(id, (other, ob))| {
                            id != block_id
                                && bb.0 <= ob.2
                                && bb.2 >= ob.0
                                && bb.1 <= ob.3
                                && bb.3 >= ob.1
                                && g::intersection(r, other).iter().map(g::area).sum::<f64>() > 0.01
                        })
                    }) {
                        continue;
                    }
                    // Only the initial junction may occupy the parent street ribbon.
                    // Everywhere else the full corridor must belong to the parent land.
                    let junction = g::ribbon(
                        &[start, inner],
                        &[parent.widths.iter().copied().fold(0.0, f64::max) + 3.0; 2],
                    );
                    let allowed = g::union(&[vec![block.shape.clone()], junction].concat());
                    if ribbons.iter().any(|r| {
                        let mut excess = vec![r.clone()];
                        for a in &allowed {
                            excess = excess
                                .into_iter()
                                .flat_map(|s| g::difference(&s, a))
                                .collect();
                        }
                        excess.iter().map(g::area).sum::<f64>() > 0.01
                    }) {
                        continue;
                    }
                    // Width must not fill a water hole, even when the centreline is dry.
                    if ribbons.iter().any(|r| {
                        g::area(r) - g::dry_clip(&surface, r).iter().map(g::area).sum::<f64>()
                            > 0.01
                    }) {
                        continue;
                    }
                    let mut after = domains.clone();
                    for r in &ribbons {
                        after = after
                            .into_iter()
                            .flat_map(|s| g::difference(&s, r))
                            .collect();
                    }
                    if after.is_empty() {
                        continue;
                    }
                    accepted = Some((
                        Street {
                            path,
                            widths,
                            rank: 4,
                            role: role.into(),
                        },
                        after,
                    ));
                    break;
                }
                if accepted.is_some() {
                    break;
                }
            }
            let Some((street, after)) = accepted else {
                break;
            };
            layout.streets.push(street);
            index = parcels::FrontageIndex::new(layout);
            domains = after;
            added += 1;
            block_added += 1;
        }
        if block_added > 0
            && let Some(court) = common
        {
            for s in &domains {
                let pieces = g::intersection(s, &court);
                for shape in pieces {
                    result.push(Block {
                        shape,
                        kind: "common".into(),
                        ..block.clone()
                    });
                }
            }
            domains = domains
                .into_iter()
                .flat_map(|s| g::difference(&s, &court))
                .collect();
        }
        result.extend(
            domains
                .into_iter()
                .filter(|s| g::area(s) > 1.0)
                .map(|shape| Block {
                    shape,
                    ..block.clone()
                }),
        );
    }
    layout.blocks = result;
    if added > 0 {
        let centers = layout
            .structure
            .as_ref()
            .map_or_else(Vec::new, |s| s.centers.iter().map(|c| c.point).collect());
        // Fortified=true suppresses ornamental tail trimming after cadastral land was carved.
        layout.warnings.extend(network::clean_with_centers(
            &mut layout.streets,
            layout.center,
            100.0,
            true,
            &centers,
        ));
    }
    if let Some(s) = layout.structure.as_mut() {
        s.metrics.access_added = added;
    }
}

pub(super) fn summarize(layout: &mut Layout, cfg: &LayoutConfig) {
    let Some(s) = layout.structure.as_mut() else {
        return;
    };
    s.allocated = g::union(
        &layout
            .quarters
            .iter()
            .map(|q| q.shape.clone())
            .collect::<Vec<_>>(),
    );
    s.metrics.allocated_area = s.allocated.iter().map(g::area).sum();
    s.metrics.components = s.allocated.len();
    s.metrics.reserved_area = layout
        .blocks
        .iter()
        .filter(|b| b.kind != "block")
        .map(|b| g::area(&b.shape))
        .sum();
    let blocks_area: f64 = layout.blocks.iter().map(|b| g::area(&b.shape)).sum();
    // Difference includes fortification strips: expose the full circulation/edge budget.
    s.metrics.street_area = (s.metrics.allocated_area - blocks_area).max(0.0);
    s.metrics.shortfall_area = (s.metrics.target_area - s.metrics.allocated_area).max(0.0);
    let mut groups: BTreeMap<(usize, usize), Vec<usize>> = BTreeMap::new();
    for (qi, q) in layout.quarters.iter().enumerate() {
        let p = g::interior_point(&q.shape);
        let center = s
            .centers
            .iter()
            .min_by(|a, b| dist(a.point, p).total_cmp(&dist(b.point, p)))
            .map_or(0, |c| c.id);
        groups.entry((center, q.phase)).or_default().push(qi);
    }
    s.districts = groups
        .into_iter()
        .enumerate()
        .map(|(id, ((center, phase), quarters))| UrbanDistrict {
            id,
            center,
            phase,
            quarters,
            // Roles and wealth are scored later by `roles::assign`, once the
            // programme stage knows waterfronts, heights and gates.
            role: String::new(),
            wealth: 0.5,
            label: String::new(),
            tissue: if cfg.tissue == "culture" && s.family == "composite" && center > 0 {
                "grid".into()
            } else {
                cfg.tissue.clone()
            },
        })
        .collect();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interior_point_and_segment_respect_a_hole() {
        let mut s = g::rectangle(0.0, 0.0, 100.0, 100.0);
        s.holes.push(
            g::rectangle(20.0, 20.0, 80.0, 80.0)
                .outer
                .into_iter()
                .rev()
                .collect(),
        );
        assert!(g::contains(&s, g::interior_point(&s)));
        assert!(!g::segment_within(
            &s,
            Point { x: 10.0, y: 50.0 },
            Point { x: 90.0, y: 50.0 }
        ));
    }
}
