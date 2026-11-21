//! Initial quarters from settlement composition or the geometric fixture.

use super::streets::add;
use crate::rng::Rng;
use crate::urban::{
    Enclosure, GrowthPhase, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    UrbanStructure, composition, geometry as g, macroplan,
};
use std::f64::consts::TAU;

pub(super) struct InitialPlan {
    pub(super) quarters: Vec<Quarter>,
    pub(super) streets: Vec<Street>,
    pub(super) enclosures: Vec<Enclosure>,
    pub(super) warnings: Vec<String>,
    pub(super) phases: Vec<GrowthPhase>,
    pub(super) structure: Option<UrbanStructure>,
    pub(super) nucleus_radius: f64,
    pub(super) archetype: String,
    pub(super) radius: f64,
    pub(super) angle: f64,
}

pub(super) fn initial_plan(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    rng: &Rng,
) -> Result<InitialPlan, String> {
    let mut prim = rng.fork("primary");
    let center = site.center;
    let radius = if cfg.radius > 0.0 {
        cfg.radius
    } else {
        site.radius * cfg.radius_scale
    };
    let count = cfg.count.clamp(3, 64);
    let rings = cfg.rings.clamp(1, 2);
    let road_angle = nearest(center, roads, 4)
        .map(|(_, a)| a)
        .unwrap_or_else(|| prim.range(0.0, TAU));
    let angle = if m.text("orientation") == "cardinal" {
        0.0
    } else {
        road_angle
    };
    let mut streets = vec![];
    let mut raw = vec![];
    if cfg.placement != "center" {
        let cols = count.div_ceil(2);
        let allcols = cols * rings;
        let x0 = center.x + radius * 0.14;
        let y0 = center.y - radius * 0.7;
        let width = radius * 1.4 * rings as f64;
        let height = radius * 1.4;
        let jitter_x = 8.0_f64.min(0.2 * width / allcols as f64);
        let jitter_y = 10.0_f64.min(0.2 * height / 2.0);
        let nodes: Vec<Vec<_>> = (0..3)
            .map(|r| {
                (0..=allcols)
                    .map(|c| {
                        let mut p = Point {
                            x: x0
                                + width * c as f64 / allcols as f64
                                + if c > 0 && c < allcols {
                                    prim.range(-jitter_x, jitter_x)
                                } else {
                                    0.0
                                },
                            y: y0
                                + height * r as f64 / 2.0
                                + if r == 1 {
                                    prim.range(-jitter_y, jitter_y)
                                } else {
                                    0.0
                                },
                        };
                        if cfg.placement == "skew" {
                            let u = (p.x - x0) / width;
                            let v = (p.y - y0) / height;
                            p.x += radius * (0.55 * v + 0.12 * u * v);
                            p.y += radius * 0.3 * u
                        }
                        p
                    })
                    .collect()
            })
            .collect();
        let horizontal: Vec<Vec<Vec<Point>>> = nodes
            .iter()
            .enumerate()
            .map(|(r, row)| {
                row.windows(2)
                    .enumerate()
                    .map(|(c, q)| {
                        if cfg.placement == "notched" && r == 0 && c % cols == cols / 2 {
                            vec![
                                q[0],
                                Point {
                                    x: (q[0].x + q[1].x) * 0.5,
                                    y: (q[0].y + q[1].y) * 0.5 + height * 0.3,
                                },
                                q[1],
                            ]
                        } else {
                            q.to_vec()
                        }
                    })
                    .collect()
            })
            .collect();
        for row in &horizontal {
            for p in row {
                add(&mut streets, p.clone(), 1, "street", m, &mut prim)
            }
        }
        for r in 0..2 {
            for (c, &p) in nodes[r].iter().enumerate() {
                add(
                    &mut streets,
                    vec![p, nodes[r + 1][c]],
                    if c == 0 { 0 } else { 1 },
                    "street",
                    m,
                    &mut prim,
                )
            }
        }
        for band in 0..rings {
            for local in 0..count {
                let row = local / cols;
                let col = band * cols + local % cols;
                let end = (col
                    + if count % 2 == 1 && local == count - 1 {
                        2
                    } else {
                        1
                    })
                .min(allcols);
                let mut pts = vec![];
                for p in &horizontal[row][col..end] {
                    pts.extend(p.iter().skip(usize::from(!pts.is_empty())).copied())
                }
                let mut bottom = vec![];
                for p in &horizontal[row + 1][col..end] {
                    bottom.extend(p.iter().skip(usize::from(!bottom.is_empty())).copied())
                }
                bottom.reverse();
                pts.extend(bottom);
                raw.push(Quarter {
                    shape: g::normalized(Shape {
                        outer: pts,
                        holes: vec![],
                    }),
                    phase: band,
                    zone: if cfg.zone == "auto" {
                        "core".into()
                    } else {
                        cfg.zone.clone()
                    },
                })
            }
        }
    }
    let fixture_footprint = g::union(&raw.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let quarters: Vec<_> = raw
        .into_iter()
        .flat_map(|q| {
            g::dry_clip(&surface, &q.shape)
                .into_iter()
                .filter(|p| g::area(p) > 1.0)
                .map(move |shape| Quarter {
                    shape,
                    phase: q.phase,
                    zone: q.zone.clone(),
                })
        })
        .collect();
    let mut phases = vec![];
    let mut structure = None;
    let mut nucleus_radius = radius;
    let mut archetype = "district".to_owned();
    let (quarters, streets, enclosures, warnings) = if cfg.placement == "center" {
        let plan = if cfg.scope == "settlement" {
            let result = composition::generate(seed, site, cfg, surface, roads, radius)?;
            phases = result.phases;
            archetype = result.archetype;
            nucleus_radius = result.nucleus_radius;
            result.plan
        } else {
            macroplan::generate(seed, site, cfg, m, surface, roads, radius)
        };
        structure = plan.structure;
        (plan.quarters, plan.streets, plan.enclosures, plan.warnings)
    } else {
        streets = streets
            .iter()
            .flat_map(|s| clip_street(s, surface, None))
            .collect();
        for st in roads {
            if matches!(st.role.as_str(), "bridge" | "ford" | "causeway") {
                for shape in &fixture_footprint {
                    streets.extend(macroplan::clip(st, shape));
                }
            } else {
                streets.extend(clip_street(st, surface, Some(&quarters)));
            }
        }
        (quarters, streets, vec![], vec![])
    };
    Ok(InitialPlan {
        quarters,
        streets,
        enclosures,
        warnings,
        phases,
        structure,
        nucleus_radius,
        archetype,
        radius,
        angle,
    })
}

fn nearest(p: Point, streets: &[Street], max_rank: usize) -> Option<(f64, f64)> {
    let mut best = f64::INFINITY;
    let mut segment = None;
    for q in streets
        .iter()
        .filter(|s| s.rank <= max_rank)
        .flat_map(|s| s.path.windows(2))
    {
        let dx = (q[0].x.min(q[1].x) - p.x)
            .max(0.0)
            .max(p.x - q[0].x.max(q[1].x));
        let dy = (q[0].y.min(q[1].y) - p.y)
            .max(0.0)
            .max(p.y - q[0].y.max(q[1].y));
        if dx * dx + dy * dy > best * best {
            continue;
        }
        let d = g::distance(p, q[0], q[1]).0;
        if d < best {
            best = d;
            segment = Some((q[0], q[1]));
        }
    }
    segment.map(|(a, b)| (best, (b.y - a.y).atan2(b.x - a.x)))
}

/// Clip centreline intervals at exact cell/map and urban-boundary crossings.
fn clip_street(st: &Street, surface: Surface<'_>, quarters: Option<&[Quarter]>) -> Vec<Street> {
    let mut out = vec![];
    let mut path: Vec<Point> = vec![];
    let mut widths = vec![];
    let cell = surface.width / surface.n as f64;
    for (i, q) in st.path.windows(2).enumerate() {
        let a = q[0];
        let b = q[1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let mut ts = vec![0.0, 1.0];
        for (a, b, delta) in [(a.x, b.x, dx), (a.y, b.y, dy)] {
            if delta.abs() < 1e-9 {
                continue;
            }
            let lo = (a.min(b) / cell).floor().max(0.0) as usize;
            let hi = ((a.max(b) / cell).ceil() as usize).min(surface.n);
            for k in lo..=hi {
                let t = (k as f64 * cell - a) / delta;
                if t > 0.0 && t < 1.0 {
                    ts.push(t)
                }
            }
        }
        if let Some(quarters) = quarters {
            for quarter in quarters {
                let ring = &quarter.shape.outer;
                for (&c, &d) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    if let Some((t, _)) = g::segment_hit(a, b, c, d) {
                        ts.push(t)
                    }
                }
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        for pair in ts.windows(2) {
            let mid = (pair[0] + pair[1]) * 0.5;
            let p = Point {
                x: a.x + dx * mid,
                y: a.y + dy * mid,
            };
            let keep = !surface.wet(p)
                && quarters.is_none_or(|qs| qs.iter().any(|q| g::contains(&q.shape, p)));
            if keep {
                let start = Point {
                    x: a.x + dx * pair[0],
                    y: a.y + dy * pair[0],
                };
                let end = Point {
                    x: a.x + dx * pair[1],
                    y: a.y + dy * pair[1],
                };
                let wa = st.widths.get(i).copied().unwrap_or(4.0);
                let wb = st.widths.get(i + 1).copied().unwrap_or(wa);
                if path
                    .last()
                    .is_some_and(|p| (p.x - start.x).hypot(p.y - start.y) > 1e-6)
                {
                    out.push(Street {
                        path: std::mem::take(&mut path),
                        widths: std::mem::take(&mut widths),
                        rank: st.rank,
                        role: st.role.clone(),
                    });
                }
                if path.is_empty() {
                    path.push(start);
                    widths.push(wa + (wb - wa) * pair[0]);
                }
                path.push(end);
                widths.push(wa + (wb - wa) * pair[1]);
            } else if path.len() > 1 {
                out.push(Street {
                    path: std::mem::take(&mut path),
                    widths: std::mem::take(&mut widths),
                    rank: st.rank,
                    role: st.role.clone(),
                });
            }
        }
    }
    if path.len() > 1 {
        out.push(Street {
            path,
            widths,
            rank: st.rank,
            role: st.role.clone(),
        });
    }
    out
}
