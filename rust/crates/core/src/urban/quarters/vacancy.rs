//! Measure housing capacity, leave surplus land open and peel vacant growth.

use crate::rng::Rng;
use crate::urban::{
    Block, CapacityPlan, Enclosure, GrowthPhase, Layout, LayoutConfig, Point, Quarter, Shape, Site, Street,
    Surface, UrbanStructure, footprint::capacity, geometry as g, warnings,
};

#[allow(clippy::too_many_arguments)]
pub(super) fn leave_fringe_fields(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    applied: &LayoutConfig,
    surface: Surface<'_>,
    quarters: &[Quarter],
    streets: &mut Vec<Street>,
    blocks: &mut [Block],
    phases: &[GrowthPhase],
    enclosures: &[Enclosure],
    archetype: &str,
    structure: Option<&UrbanStructure>,
    plan: &mut Option<CapacityPlan>,
    vacancies: &[Option<f64>],
    warnings: &mut Vec<String>,
    rng: &Rng,
    lap: &impl Fn(&str),
) -> f64 {
    let center = site.center;
    let fringe = rng.fork("open-fringe");
    // Invariant: the parcels hold the households the plan needs. Their real
    // capacity is measured on a sample of these blocks with the parcel stage
    // itself (`capacity::measure`); when short, the lots densify further within
    // the culture's ranges. Fringe fields then take only the measured surplus:
    // the vacancy chances are scaled so the expected land left open stays
    // within it, and each block draws from its own stream keyed by its
    // geometry, so a change elsewhere in the network never reshuffles it.
    lap("blocks.cut");
    let mut measured: Option<Vec<f64>> = None;
    // A tissue predicted to hold `capacity::AMPLE` times its households, as
    // drawn, is not measured: even the largest over-prediction of the sweep
    // leaves it housed, and its fringe stays the culture's own.
    let ample = plan.as_ref().is_some_and(|p| {
        p.densify <= 0.0
            && p.extension <= 1.001
            && p.borrowed_share <= 0.0
            && p.forecast >= capacity::AMPLE * p.required
    });
    if let Some(p) = plan.as_mut().filter(|_| !ample) {
        let mut probe = Layout {
            config: Some(applied.clone()),
            programme: None,
            key: site.key.clone(),
            culture: if cfg.culture == "site" {
                site.culture.clone()
            } else {
                cfg.culture.clone()
            },
            center,
            quarters: quarters.to_vec(),
            streets: streets.clone(),
            blocks: blocks.to_vec(),
            warnings: vec![],
            enclosures: vec![],
            phases: phases.to_vec(),
            archetype: archetype.to_owned(),
            structure: structure.cloned(),
            claim: Default::default(),
        };

        // The homes the rule asks plus the housing margin (`p.required`),
        // before the block loss: no estimator margin stacked on top.
        let required = p.required / (1.0 - capacity::BLOCK_LOSS);
        let run = |p: &CapacityPlan, probe: &mut Layout| {
            if let Some(s) = probe.structure.as_mut() {
                s.metrics.capacity = Some(p.clone());
            }
            capacity::measure(probe, seed, cfg, site.population, surface)
        };
        let mut found = run(p, &mut probe);
        let total = |m: &Option<capacity::Measure>| {
            m.as_ref().map_or(0.0, |m| m.per_block.iter().sum::<f64>())
        };
        // The plan's own prediction, measured: the tissue as planned, with
        // the culture's own fringe fields (the closed loop compares the two).
        if let Some(m) = &found {
            let open: f64 = m
                .per_block
                .iter()
                .zip(vacancies)
                .map(|(h, v)| h * v.unwrap_or(0.0))
                .sum();
            p.measured_plan = (total(&found) - open) * (1.0 - capacity::BLOCK_LOSS);
        }
        if total(&found) < required && p.densify < 1.0 {
            let (t0, h0) = (p.densify, total(&found));
            let mut dense = p.clone();
            dense.densify = 1.0;
            let full = run(&dense, &mut probe);
            let h1 = total(&full);
            if h1 > h0 {
                // Lots densify only as far as needed (linear between the two).
                let t = if h1 <= required {
                    1.0
                } else {
                    (t0 + (1.0 - t0) * (required - h0) / (h1 - h0)).clamp(t0, 1.0)
                };
                p.densify = (t * 100.0).ceil() / 100.0;
                found = if p.densify >= 1.0 {
                    full
                } else {
                    run(p, &mut probe)
                };
            }
        }
        if let Some(m) = found {
            let total: f64 = m.per_block.iter().sum();
            let open: f64 = m
                .per_block
                .iter()
                .zip(vacancies)
                .map(|(h, v)| h * v.unwrap_or(0.0))
                .sum();
            p.vacancy = if open > 0.0 {
                ((total - required) / open).clamp(0.0, 1.0)
            } else {
                1.0
            };
            p.measured_garden = m.garden;
            measured = Some(m.per_block);
        }
    }
    let vacancy_scale = plan.as_ref().map_or(1.0, |p| p.vacancy);
    // Invariant: the fringe never empties the settlement. The draws are
    // independent per block, so on a settlement of one or two blocks (a camp,
    // a street village) a single draw can leave the whole place open ground:
    // the last built block always stays.
    let mut built = blocks.iter().filter(|b| b.kind == "block").count();
    // Enclosure rings indexed once (same arithmetic as `g::contains`).
    let rings: Vec<g::ContainmentIndex> = enclosures
        .iter()
        .map(|e| g::ContainmentIndex::new(&Shape { outer: e.path.clone(), holes: vec![] }))
        .collect();
    for (b, vacancy) in blocks.iter_mut().zip(vacancies) {
        if let Some(vacancy) = vacancy
            && b.kind == "block"
            && b.zone != "core"
            && !rings.iter().any(|r| r.contains(g::interior_point(&b.shape)))
        {
            let c = g::interior_point(&b.shape);
            // The block's interior point on a 2 m grid: its identity, blind
            // to sub-metre jitter of its outline.
            let key = format!("block:{:.0}:{:.0}", c.x / 2.0, c.y / 2.0);
            if fringe.fork(&key).chance(vacancy * vacancy_scale) && built > 1 {
                b.kind = "reserve".into();
                built -= 1;
            }
        }
    }
    // A small village is cut to the lots it fills: the outermost blocks beyond the housing the
    // plan needs (its housing margin, rounded up by the last block) are open land, and the
    // lanes that served only them go too.
    if site.population < 1200
        && enclosures.is_empty()
        && measured.is_some()
        && let Some(p) = plan.as_ref()
        && p.required > 0.0
    {
        let need = p.required / (1.0 - capacity::BLOCK_LOSS);
        let all_area: f64 = blocks.iter().filter(|b| b.kind == "block").map(|b| g::area(&b.shape)).sum::<f64>().max(1.0);
        let yield_of = |i: usize, b: &Block| match &measured {
            Some(m) => m.get(i).copied().unwrap_or(0.0),
            None => p.forecast / (1.0 - capacity::BLOCK_LOSS) * g::area(&b.shape) / all_area,
        };
        let mut order: Vec<usize> = (0..blocks.len()).filter(|&i| blocks[i].kind == "block").collect();
        let from_centre = |i: usize| {
            let c = g::interior_point(&blocks[i].shape);
            (c.x - center.x).hypot(c.y - center.y)
        };
        order.sort_by(|&a, &b| from_centre(a).total_cmp(&from_centre(b)));
        let mut have = 0.0;
        let mut dropped = 0;
        for i in order {
            if have >= need && built > 1 {
                blocks[i].kind = "reserve".into();
                built -= 1;
                dropped += 1;
            } else {
                have += yield_of(i, &blocks[i]);
            }
        }
        if dropped > 0 {
            // Lanes that now touch no built block lead nowhere.
            let live: Vec<&Block> = blocks.iter().filter(|b| b.kind == "block").collect();
            streets.retain(|st| {
                st.role != "lane"
                    || live.iter().any(|b| {
                        b.shape.outer.iter().any(|&v| {
                            st.path.windows(2).any(|w| g::distance(v, w[0], w[1]).0 < st.widths[0] * 0.5 + 3.0)
                        })
                    })
            });
            warnings.push(warnings::housing_blocks_left_open(dropped));
        }
    }
    lap("blocks.fringe_fields");
    let predicted: f64 = measured.as_ref().map_or_else(
        || {
            plan.as_ref()
                .map_or(0.0, |p| p.forecast / (1.0 - capacity::BLOCK_LOSS))
        },
        |m| {
            m.iter()
                .zip(blocks.iter())
                .filter(|(_, b)| b.kind == "block")
                .map(|(h, _)| h)
                .sum()
        },
    );
    lap("blocks");
    predicted
}

/// Vacant blocks on the town's outer edge (reserve land the capacity plan
/// did not need, or land no street reaches) return to the countryside, layer
/// by layer from the outside in, and the streets left serving no kept block
/// go with them: the town ends at its last houses, not in a fringe of empty
/// lattice cells. Interior reserves (between built blocks) stay.
pub(super) fn peel_vacant_edges(layout: &mut Layout) -> usize {
    // Beyond any street: a sample this far outside a block lands in a
    // neighbouring block when the block is not on the edge.
    const REACH: f64 = 25.0;
    let n = layout.blocks.len();
    if n < 2 {
        return 0;
    }
    let boxes: Vec<_> = layout.blocks.iter().map(|b| g::bbox(&b.shape)).collect();
    // Grid of block indices for point queries.
    let cell = 120.0;
    let mut grid: std::collections::HashMap<(i64, i64), Vec<usize>> = std::collections::HashMap::new();
    for (i, b) in boxes.iter().enumerate() {
        for x in (b.0 / cell).floor() as i64..=(b.2 / cell).floor() as i64 {
            for y in (b.1 / cell).floor() as i64..=(b.3 / cell).floor() as i64 {
                grid.entry((x, y)).or_default().push(i);
            }
        }
    }
    let samples: Vec<Vec<Point>> = layout
        .blocks
        .iter()
        .map(|b| {
            let r = &b.shape.outer;
            let ccw = g::signed(r) > 0.0;
            let stride = r.len().div_ceil(48).max(1);
            (0..r.len())
                .step_by(stride)
                .filter_map(|k| {
                    let (a, c) = (r[k], r[(k + 1) % r.len()]);
                    let l = (c.x - a.x).hypot(c.y - a.y);
                    if l < 1.0 {
                        return None;
                    }
                    // Outward normal at the edge's middle.
                    let (nx, ny) = if ccw { ((c.y - a.y) / l, -(c.x - a.x) / l) } else { (-(c.y - a.y) / l, (c.x - a.x) / l) };
                    Some(Point { x: (a.x + c.x) / 2.0 + nx * REACH, y: (a.y + c.y) / 2.0 + ny * REACH })
                })
                .collect()
        })
        .collect();
    let mut gone = vec![false; n];
    let inside_kept = |p: Point, gone: &[bool]| {
        grid.get(&((p.x / cell).floor() as i64, (p.y / cell).floor() as i64)).is_some_and(|ids| {
            ids.iter().any(|&j| {
                let b = boxes[j];
                !gone[j] && p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 && g::contains(&layout.blocks[j].shape, p)
            })
        })
    };
    let mut peeled = 0;
    for _ in 0..12 {
        let edge: Vec<usize> = (0..n)
            .filter(|&i| !gone[i] && layout.blocks[i].kind == "reserve")
            .filter(|&i| samples[i].iter().any(|&p| !inside_kept(p, &gone)))
            .collect();
        if edge.is_empty() {
            break;
        }
        for i in edge {
            gone[i] = true;
            peeled += 1;
        }
    }
    if peeled == 0 {
        return 0;
    }
    let mut k = 0;
    layout.blocks.retain(|_| {
        k += 1;
        !gone[k - 1]
    });
    // Streets serving no kept block (every sample far from all of them), with
    // the grown boxes of the kept blocks in the same grid cells.
    let kept_boxes: Vec<_> = layout.blocks.iter().map(|b| { let b = g::bbox(&b.shape); (b.0 - 15.0, b.1 - 15.0, b.2 + 15.0, b.3 + 15.0) }).collect();
    let mut kept_grid: std::collections::HashMap<(i64, i64), Vec<usize>> = std::collections::HashMap::new();
    for (i, b) in kept_boxes.iter().enumerate() {
        for x in (b.0 / cell).floor() as i64..=(b.2 / cell).floor() as i64 {
            for y in (b.1 / cell).floor() as i64..=(b.3 / cell).floor() as i64 {
                kept_grid.entry((x, y)).or_default().push(i);
            }
        }
    }
    let near_kept = |p: Point| {
        kept_grid.get(&((p.x / cell).floor() as i64, (p.y / cell).floor() as i64)).is_some_and(|ids| {
            ids.iter().any(|&j| { let b = kept_boxes[j]; p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 })
        })
    };
    layout.streets.retain(|s| {
        matches!(s.role.as_str(), "regional" | "outbound" | "bridge" | "crossing" | "quay")
            || s.path.iter().any(|&p| near_kept(p))
    });
    // `structure.allocated` keeps the footprint until `access::summarize`
    // rebuilds it from the kept quarters; nothing reads it in between.
    peeled
}

/// Growth quarters left wholly vacant (no block, or every block a reserve: the capacity
/// plan housed the town without them) return to the countryside: their
/// blocks, the streets serving only them and their share of the footprint
/// go, instead of empty quarters of gardens outside the town. Composition
/// quarters (phase 0) keep their place and index.
pub(super) fn drop_vacant_quarters(layout: &mut Layout) -> usize {
    let q = layout.quarters.len();
    let mut blocks_of = vec![0usize; q];
    let mut reserves = vec![0usize; q];
    for b in &layout.blocks {
        if b.quarter < q {
            blocks_of[b.quarter] += 1;
            if b.kind == "reserve" {
                reserves[b.quarter] += 1;
            }
        }
    }
    let drop: Vec<bool> = (0..q)
        .map(|i| layout.quarters[i].phase > 0 && reserves[i] == blocks_of[i])
        .collect();
    let dropped = drop.iter().filter(|&&d| d).count();
    if dropped == 0 || dropped == q {
        return 0;
    }
    let index: Vec<((f64, f64, f64, f64), g::ContainmentIndex)> = (0..q)
        .filter(|&i| drop[i])
        .map(|i| (g::bbox(&layout.quarters[i].shape), g::ContainmentIndex::new(&layout.quarters[i].shape)))
        .collect();
    let inside = |p: Point| index.iter().any(|(b, c)| p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 && c.contains(p));
    layout.streets.retain(|s| {
        matches!(s.role.as_str(), "regional" | "outbound" | "bridge" | "crossing")
            || !s.path.iter().all(|&p| inside(p))
    });
    let mut remap = vec![usize::MAX; q];
    let mut next = 0;
    for i in 0..q {
        if !drop[i] {
            remap[i] = next;
            next += 1;
        }
    }
    layout.blocks.retain(|b| b.quarter >= q || !drop[b.quarter]);
    for b in &mut layout.blocks {
        if b.quarter < q {
            b.quarter = remap[b.quarter];
        }
    }
    let mut k = 0;
    layout.quarters.retain(|_| {
        k += 1;
        !drop[k - 1]
    });
    // `structure.allocated` is rebuilt from the kept quarters by `access::summarize`.
    if let Some(st) = layout.structure.as_mut() {
        if let Some(c) = st.metrics.capacity.as_mut() {
            c.borrowed_quarters = c.borrowed_quarters.iter().filter(|&&i| i < q && !drop[i]).map(|&i| remap[i]).collect();
        }
    }
    dropped
}
