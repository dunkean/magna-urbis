//! Peripheral frontage quarters and harbour extensions around the finished armature.

use super::subdivision::Piece;
use crate::rng::Rng;
use crate::urban::{
    Enclosure, GrowthPhase, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    UrbanDistrict, UrbanStructure, fringe, geometry as g, influences, macroplan,
};

#[allow(clippy::too_many_arguments)]
pub(super) fn extend_frontage(
    quarters: &mut Vec<Quarter>,
    streets: &mut Vec<Street>,
    pieces: &mut Vec<Vec<Piece>>,
    enclosures: &[Enclosure],
    phases: &mut Vec<GrowthPhase>,
    structure: &mut Option<UrbanStructure>,
    open_edge: bool,
    site: &Site,
    cfg: &LayoutConfig,
    applied: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    rng: &Rng,
    lap: &impl Fn(&str),
) {
    if open_edge
        && cfg.scope == "settlement"
        && cfg.exit_treatment != "legacy"
        && cfg.footprint.mechanism != "legacy"
    {
        let frontage = fringe::frontages(
            quarters,
            streets,
            surface,
            m.range("plotDepth", "edge")[0],
            cfg.max_lane_grade,
            &mut rng.fork("peripheral-frontage"),
        );
        lap("fringe.frontages");
        let frontage = off_reserve(frontage, enclosures, streets);
        let first_outer = quarters.len();
        // Peripheral frontage inherits the density of its epoch, so the dense
        // core keeps its share of the population after the extension.
        let densities: Vec<f64> = phases
            .iter()
            .map(|p| p.population / p.shapes.iter().map(g::area).sum::<f64>().max(1.0))
            .collect();
        let mut extensions = phases.clone();
        for p in &mut extensions {
            p.shapes.clear();
        }
        for (shape, source) in frontage {
            let phase = quarters[source].phase;
            quarters.push(Quarter {
                shape: shape.clone(),
                phase,
                zone: quarters[source].zone.clone(),
            });
            pieces.push(vec![Piece {
                shape: shape.clone(),
                level: 0,
                kind: "block".into(),
            }]);
            if let Some(p) = extensions.get_mut(phase) {
                p.shapes.push(shape);
            }
        }
        if !cfg.mix_culture.is_empty() && first_outer < quarters.len() {
            extensions.retain(|p| !p.shapes.is_empty());
            influences::apply(&mut extensions, &mut quarters[first_outer..], site, cfg);
            for q in &mut quarters[first_outer..] {
                q.phase += phases.len();
            }
            phases.extend(extensions);
        } else {
            for (p, extension) in phases.iter_mut().zip(extensions) {
                p.shapes.extend(extension.shapes);
            }
        }
        influences::zone_overrides(phases, site, cfg);
        let area: f64 = phases.iter().flat_map(|p| &p.shapes).map(g::area).sum();
        let density = |i: usize| {
            densities
                .get(i % densities.len().max(1))
                .copied()
                .unwrap_or(1.0)
        };
        let housed: f64 = phases
            .iter()
            .enumerate()
            .map(|(i, p)| p.shapes.iter().map(g::area).sum::<f64>() * density(i))
            .sum();
        if area > 0.0 && housed > 0.0 {
            for (i, p) in phases.iter_mut().enumerate() {
                let share = p.shapes.iter().map(g::area).sum::<f64>() / area;
                p.population = site.population as f64 * share * area * density(i) / housed;
                if let Some(s) = structure.as_ref() {
                    p.target_area = s.metrics.target_area * share;
                }
            }
        }
    }
    // The waterfront of the final quarters (peripheral frontage included)
    // gets its quays, beyond those of the plan (`harbour::quays`).
    let culture = if cfg.culture == "site" {
        site.culture.as_str()
    } else {
        cfg.culture.as_str()
    };
    lap("fringe.extensions");
    let shapes: Vec<Shape> = quarters.iter().map(|q| q.shape.clone()).collect();
    // Dock access obeys the user's stair setting, including in non-terraced towns.
    for shape in macroplan::harbour::extend(&shapes, streets, surface, site, applied, culture) {
        let phase=quarters.iter().min_by(|a,b| {
            let p=g::interior_point(&shape);
            let d=|q:&Quarter| (g::interior_point(&q.shape).x-p.x).hypot(g::interior_point(&q.shape).y-p.y);
            d(a).total_cmp(&d(b))
        }).map_or(0,|q|q.phase);
        let qi=quarters.len();
        quarters.push(Quarter{shape:shape.clone(),phase,zone:"edge".into()});
        pieces.push(macroplan::harbour::port_blocks(&shape).into_iter().map(|shape|Piece{shape,level:0,kind:"block".into()}).collect());
        if let Some(p)=phases.get_mut(phase) {p.shapes.push(shape.clone());}
        if let Some(s)=structure.as_mut() {
            s.allocated.push(shape.clone());s.allocated=g::union(&s.allocated);
            s.reserve.push(shape);s.reserve=g::union(&s.reserve);
            s.metrics.allocated_area=s.allocated.iter().map(g::area).sum();
            s.metrics.components=s.allocated.len();
            s.districts.push(UrbanDistrict{id:s.districts.len(),center:0,phase,tissue:cfg.tissue.clone(),quarters:vec![qi],role:String::new(),wealth:0.5,label:String::new()});
        }
    }
    if cfg.placement == "center" || macroplan::harbour::shelter_weight(cfg)>0.0 || cfg.port_detachment<1.0 {
        let shapes: Vec<Shape> = quarters.iter().map(|q| q.shape.clone()).collect();
        let town = enclosures.is_empty() && !macroplan::harbour::own_front(streets, surface, cfg, site, culture);
        macroplan::harbour::quays(&shapes, streets, surface, cfg, site, culture, town);
    }
    lap("fringe.harbour");
}

/// Smallest frontage piece kept where the fortification reserve cuts it.
const MIN_FRONTAGE_PIECE: f64 = 100.0;

/// Peripheral frontage never takes the fortification reserve (curtain body,
/// ditch, berm, glacis, works): each piece gives it up before it becomes a
/// quarter, keeping its parts of at least `MIN_FRONTAGE_PIECE` m² that still
/// face a peripheral road (a part cut off behind the glacis has no street).
fn off_reserve(
    frontage: Vec<(Shape, usize)>,
    enclosures: &[Enclosure],
    streets: &[Street],
) -> Vec<(Shape, usize)> {
    let reserve: Vec<(Shape, (f64, f64, f64, f64))> = enclosures
        .iter()
        .flat_map(|e| e.reserve.iter())
        .map(|r| (r.clone(), g::bbox(r)))
        .collect();
    if reserve.is_empty() {
        return frontage;
    }
    let overlaps = |a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)| {
        a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
    };
    let roads: Vec<(Point, Point, f64, (f64, f64, f64, f64))> = streets
        .iter()
        .filter(|s| s.role == "peripheral")
        .flat_map(|s| {
            s.path.windows(2).enumerate().map(move |(i, w)| {
                let half = s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0) * 0.5;
                let m = half + 1.5;
                let bb = (
                    w[0].x.min(w[1].x) - m,
                    w[0].y.min(w[1].y) - m,
                    w[0].x.max(w[1].x) + m,
                    w[0].y.max(w[1].y) + m,
                );
                (w[0], w[1], m, bb)
            })
        })
        .collect();
    // The frontage band holds its road corridor: a part faces the road when
    // the road runs through it or passes within its half width + 1.5 m.
    let faces_road = |s: &Shape| {
        let bb = g::bbox(s);
        let ring = &s.outer;
        roads.iter().any(|&(a, b, m, rb)| {
            overlaps(bb, rb)
                && (g::contains(s, a)
                    || g::contains(s, b)
                    || ring.iter().any(|&p| g::distance(p, a, b).0 <= m)
                    || ring
                        .iter()
                        .zip(ring.iter().cycle().skip(1))
                        .any(|(&c, &d)| g::segment_hit(a, b, c, d).is_some()))
        })
    };
    frontage
        .into_iter()
        .flat_map(|(shape, source)| {
            let bb = g::bbox(&shape);
            let mut parts = vec![shape.clone()];
            for (r, rb) in &reserve {
                if !overlaps(bb, *rb) {
                    continue;
                }
                parts = parts
                    .into_iter()
                    .flat_map(|p| {
                        if overlaps(g::bbox(&p), *rb) {
                            g::difference(&p, r)
                        } else {
                            vec![p]
                        }
                    })
                    .collect();
            }
            let cut = (parts.iter().map(g::area).sum::<f64>() - g::area(&shape)).abs() > 0.5;
            if !cut {
                return vec![(shape, source)];
            }
            parts
                .into_iter()
                .filter(|p| g::area(p) >= MIN_FRONTAGE_PIECE && faces_road(p))
                .map(|p| (p, source))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
#[path = "frontage_tests.rs"]
mod frontage_tests;
