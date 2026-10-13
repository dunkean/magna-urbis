//! Cultural ownership is disjoint land, shared by street guidance and parcels.
use super::{GrowthPhase, LayoutConfig, Point, Quarter, Shape, Site, composition, geometry as g};

fn mask(center: Point, extent: f64, value: f64, angle: f64, chronological: bool) -> Shape {
    if chronological {
        return Shape {
            outer: (0..96)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / 96.0;
                    Point {
                        x: center.x + value * a.cos(),
                        y: center.y + value * a.sin(),
                    }
                })
                .collect(),
            holes: vec![],
        };
    }
    let at = |u: f64, v: f64| Point {
        x: center.x + u * angle.cos() - v * angle.sin(),
        y: center.y + u * angle.sin() + v * angle.cos(),
    };
    g::normalized(Shape {
        outer: vec![
            at(-extent, -extent),
            at(value, -extent),
            at(value, extent),
            at(-extent, extent),
        ],
        holes: vec![],
    })
}

pub(super) fn apply(
    phases: &mut Vec<GrowthPhase>,
    quarters: &mut [Quarter],
    site: &Site,
    cfg: &LayoutConfig,
) {
    let primary = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    if cfg.mix_culture.is_empty() || cfg.mix_culture == *primary || cfg.mix_share == 0.0 {
        return;
    }
    if phases.is_empty() {
        phases.push(GrowthPhase {
            culture: primary.clone(),
            kind: "core".into(),
            zone: "core".into(),
            recipe: "core".into(),
            population: site.population as f64,
            target_area: quarters.iter().map(|q| g::area(&q.shape)).sum(),
            shapes: quarters.iter().map(|q| q.shape.clone()).collect(),
        });
    }
    let total: f64 = phases.iter().flat_map(|p| &p.shapes).map(g::area).sum();
    let chronological = cfg.mix_mode == "phases";
    let mut inherited = total * (1.0 - cfg.mix_share);
    let extent = phases
        .iter()
        .flat_map(|p| &p.shapes)
        .flat_map(|s| &s.outer)
        .map(|p| (p.x - site.center.x).hypot(p.y - site.center.y))
        .fold(1.0_f64, f64::max)
        * 2.0;
    let partition = |shapes: &[Shape], target: f64| {
        let (mut lo, mut hi) = (if chronological { 0.0 } else { -extent }, extent);
        for _ in 0..28 {
            let mid = (lo + hi) * 0.5;
            let m = mask(
                site.center,
                extent,
                mid,
                cfg.mix_angle.to_radians(),
                chronological,
            );
            let area: f64 = shapes
                .iter()
                .flat_map(|s| g::intersection(s, &m))
                .map(|s| g::area(&s))
                .sum();
            if area < target {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        mask(
            site.center,
            extent,
            (lo + hi) * 0.5,
            cfg.mix_angle.to_radians(),
            chronological,
        )
    };
    let sector = (!chronological).then(|| {
        partition(
            &phases
                .iter()
                .flat_map(|p| p.shapes.clone())
                .collect::<Vec<_>>(),
            total * (1.0 - cfg.mix_share),
        )
    });
    let mut result = vec![];
    for phase in phases.iter() {
        let area: f64 = phase.shapes.iter().map(g::area).sum();
        let keep = if chronological {
            inherited.clamp(0.0, area)
        } else {
            area
        };
        let m = sector
            .clone()
            .unwrap_or_else(|| partition(&phase.shapes, keep));
        let (old, new) = if chronological && keep >= area {
            (phase.shapes.clone(), vec![])
        } else if chronological && keep <= 0.0 {
            (vec![], phase.shapes.clone())
        } else {
            (
                phase
                    .shapes
                    .iter()
                    .flat_map(|s| g::intersection(s, &m))
                    .collect(),
                phase
                    .shapes
                    .iter()
                    .flat_map(|s| g::difference(s, &m))
                    .collect(),
            )
        };
        inherited -= area;
        for (shapes, culture) in [(old, primary), (new, &cfg.mix_culture)] {
            let area: f64 = shapes.iter().map(g::area).sum();
            if area < 1e-6 {
                continue;
            }
            let mut p = phase.clone();
            p.culture = culture.clone();
            if culture != primary {
                p.recipe = composition::recipe(
                    culture,
                    site.population,
                    if phase.zone == "village" {
                        "village"
                    } else if phase.zone == "core" {
                        "core"
                    } else if phase.zone == "faubourg" {
                        "faubourg"
                    } else {
                        "ring"
                    },
                );
            }
            let fraction = area / phase.shapes.iter().map(g::area).sum::<f64>();
            p.population *= fraction;
            p.target_area *= fraction;
            p.shapes = shapes;
            result.push(p);
        }
    }
    *phases = result;
    for q in quarters {
        q.phase = phases
            .iter()
            .enumerate()
            .map(|(i, p)| {
                (
                    i,
                    p.shapes
                        .iter()
                        .flat_map(|s| g::intersection(&q.shape, s))
                        .map(|s| g::area(&s))
                        .sum::<f64>(),
                )
            })
            .max_by(|a, b| a.1.total_cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
            .map_or(0, |v| v.0);
        q.zone = phases[q.phase].zone.clone();
    }
}
