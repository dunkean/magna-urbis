//! Carve blocks from street and wall ribbons, then repair streetless pieces and slivers.

use super::frames::frame;
use super::street_index::Bins;
use super::subdivision::Piece;
use super::tissue::{smooth, zone_at};
use crate::urban::{
    Block, Enclosure, GrowthPhase, LayoutConfig, Point, Quarter, Shape, Street, Surface,
    geometry as g, macroplan, network, par, warnings,
};

/// Ribbon polygons binned by bounding box: a piece visits only the ribbons
/// whose box shares a cell with its own, in ascending ribbon order so the
/// polygon differences run in street order.
struct RibbonBins {
    cell: f64,
    map: std::collections::HashMap<(i64, i64), Vec<u32>>,
}
impl RibbonBins {
    fn new(ribbons: &[(Shape, (f64, f64, f64, f64))]) -> Self {
        let cell = 100.0;
        let mut map: std::collections::HashMap<(i64, i64), Vec<u32>> = Default::default();
        for (k, (_, b)) in ribbons.iter().enumerate() {
            for y in (b.1 / cell).floor() as i64..=(b.3 / cell).floor() as i64 {
                for x in (b.0 / cell).floor() as i64..=(b.2 / cell).floor() as i64 {
                    map.entry((x, y)).or_default().push(k as u32);
                }
            }
        }
        Self { cell, map }
    }
    fn candidates(&self, b: (f64, f64, f64, f64)) -> Vec<usize> {
        let c = self.cell;
        let mut out: Vec<usize> = vec![];
        for y in (b.1 / c).floor() as i64..=(b.3 / c).floor() as i64 {
            for x in (b.0 / c).floor() as i64..=(b.2 / c).floor() as i64 {
                if let Some(v) = self.map.get(&(x, y)) {
                    out.extend(v.iter().map(|&k| k as usize));
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn carve_blocks(
    pieces: Vec<Vec<Piece>>,
    quarters: &[Quarter],
    streets: &[Street],
    enclosures: &[Enclosure],
    phases: &[GrowthPhase],
    walled: &[Shape],
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    center: Point,
    radius: f64,
    nucleus_radius: f64,
    population: u32,
    lap: &impl Fn(&str),
) -> (Vec<Block>, Vec<Option<f64>>) {
    let seaward = macroplan::harbour::seaward(streets, surface);
    // Street and wall ribbons, built per street in parallel (input order),
    // with the land between each quay and its water.
    let ribbon_sources: Vec<(&[Point], Vec<f64>)> = streets
        .iter()
        .map(|s| (s.path.as_slice(), s.widths.clone()))
        .chain(seaward.iter().map(|(p, w)| (p.as_slice(), w.clone())))
        .chain(enclosures.iter().map(|e| {
            (
                e.path.as_slice(),
                vec![if e.kind == "wall" { 3.0 } else { 1.5 }],
            )
        }))
        .collect();
    let dead = network::dead_ends(streets);
    let ribbons: Vec<_> = par::map(&ribbon_sources, |i, (path, widths)| {
        let pieces = g::ribbon(path, widths);
        match dead.get(i) {
            Some(&ends) => network::square_ends(pieces, path, widths, ends),
            None => pieces,
        }
        .into_iter()
        .map(|p| {
            let bb = g::bbox(&p);
            (p, bb)
        })
        .collect::<Vec<_>>()
    })
    .into_iter()
    .flatten()
    .collect();
    drop(ribbon_sources);
    let ribbon_bins = RibbonBins::new(&ribbons);
    lap("blocks.ribbons");
    let mut blocks = vec![];
    // Backland vacancy is measured from the final main streets (rank <= 1).
    let mut final_bins = Bins::new(50.0, 1);
    final_bins.sync(streets);
    let flat: Vec<(usize, Piece)> = pieces
        .into_iter()
        .enumerate()
        .flat_map(|(qi, pcs)| pcs.into_iter().map(move |pc| (qi, pc)))
        .collect();
    // Pure per piece (parallel): street ribbons cut out in ribbon order, then
    // the frame, phase and backland vacancy of each remaining shape. The
    // vacancy draw stays serial below, in piece order.
    let cut_pieces = par::map(&flat, |_, (_, pc)| {
        let bb = g::bbox(&pc.shape);
        let mut polys = vec![pc.shape.clone()];
        for k in ribbon_bins.candidates(bb) {
            let (r, rb) = &ribbons[k];
            if bb.0 > rb.2 || bb.2 < rb.0 || bb.1 > rb.3 || bb.3 < rb.1 {
                continue;
            }
            polys = polys
                .into_iter()
                .flat_map(|p| g::difference(&p, r))
                .collect();
            if polys.is_empty() {
                break;
            }
        }
        if !cfg.mix_culture.is_empty() {
            polys = polys
                .into_iter()
                .flat_map(|shape| {
                    phases.iter().flat_map(move |p| {
                        p.shapes.iter().flat_map({
                            let shape = shape.clone();
                            move |s| g::intersection(&shape, s)
                        })
                    })
                })
                .collect();
        }
        polys
            .into_iter()
            .filter(|p| g::area(p) > 1.0)
            .map(|shape| {
                let f = frame(&shape);
                let vacancy = (pc.kind == "block"
                    && cfg.placement == "center"
                    && !walled.iter().any(|w| g::contains(w, f.c)))
                .then(|| {
                    let distance = (f.c.x - center.x).hypot(f.c.y - center.y) / nucleus_radius;
                    let arterial = final_bins
                        .nearest(f.c, streets, 1, 100.0)
                        .map_or(f64::INFINITY, |v| v.0);
                    // Leave whole backland cells between the populated fingers.
                    // No parcel is clipped by a second decorative city outline.
                    smooth(distance, 0.7, 1.05) * smooth(arterial, 18.0, 90.0) * 0.8
                });
                let phase = if phases.is_empty() {
                    None
                } else {
                    let interior = g::interior_point(&shape);
                    phases
                        .iter()
                        .position(|p| p.shapes.iter().any(|s| g::contains(s, interior)))
                };
                (shape, f, vacancy, phase)
            })
            .collect::<Vec<_>>()
    });
    let mut vacancies = vec![];
    for ((qi, pc), shapes) in flat.into_iter().zip(cut_pieces) {
        for (shape, f, vacancy, phase) in shapes {
            vacancies.push(vacancy);
            blocks.push(Block {
                phase,
                zone: if let Some(i) = phase {
                    phases[i].zone.clone()
                } else if !phases.is_empty() {
                    quarters[qi].zone.clone()
                } else if cfg.zone == "auto" {
                    zone_at(f.c, center, radius, population).into()
                } else {
                    cfg.zone.clone()
                },
                shape,
                quarter: qi,
                kind: pc.kind.clone(),
                axis: f.u,
            })
        }
    }
    (blocks, vacancies)
}

pub(super) fn repair_unserved_blocks(
    blocks: &mut Vec<Block>,
    streets: &[Street],
    warnings: &mut Vec<String>,
) {
    // A block that fronts no street (a strip between a wall and the town
    // edge) cannot be parcelled; it stays open land rather than lots served
    // by nothing.
    let mut all = Bins::new(20.0, usize::MAX);
    all.sync(streets);
    let reach = streets
        .iter()
        .flat_map(|s| s.widths.iter())
        .fold(0.0, |a: f64, &w| a.max(w))
        * 0.5
        + 2.0;
    let served = |b: &Block| block_boundary_served(&b.shape, streets, &all, reach);
    let mut served_flags = par::map(blocks, |_, b| served(b));
    let unserved: Vec<usize> = (0..blocks.len())
        .filter(|&i| blocks[i].kind == "block" && !served_flags[i])
        .collect();
    // A cut whose street was dropped later (isolated fragment, grade) leaves
    // its two sides touching: the streetless side rejoins its served neighbour.
    let mut closed = 0;
    let mut gone = vec![false; blocks.len()];
    // Block boxes once (kept current on merges), not per unserved block.
    let mut boxes: Vec<_> = blocks.iter().map(|b| g::bbox(&b.shape)).collect();
    for i in unserved {
        let bb = boxes[i];
        let neighbour = (0..blocks.len()).find_map(|j| {
            let b = &blocks[j];
            let o = boxes[j];
            if j == i
                || gone[j]
                || b.quarter != blocks[i].quarter
                || b.kind != "block"
                || o.0 > bb.2 + 0.5
                || bb.0 > o.2 + 0.5
                || o.1 > bb.3 + 0.5
                || bb.1 > o.3 + 0.5
                || !served_flags[j]
            {
                return None;
            }
            let merged = g::union(&[b.shape.clone(), blocks[i].shape.clone()]);
            (merged.len() == 1).then(|| (j, merged.into_iter().next().unwrap()))
        });
        if let Some((j, shape)) = neighbour {
            blocks[j].shape = shape;
            boxes[j] = g::bbox(&blocks[j].shape);
            served_flags[j] = served(&blocks[j]);
            gone[i] = true;
        } else {
            blocks[i].kind = "reserve".into();
            closed += 1;
        }
    }
    let mut index = 0;
    blocks.retain(|_| {
        index += 1;
        !gone[index - 1]
    });
    rejoin_slivers(blocks);
    if closed > 0 {
        warnings.push(warnings::streetless_blocks_left_open(closed));
    }
}

/// Length of every ring of a shape.
fn perimeter(s: &Shape) -> f64 {
    std::iter::once(&s.outer)
        .chain(&s.holes)
        .map(|r| {
            r.iter()
                .zip(r.iter().cycle().skip(1))
                .map(|(a, b)| (a.x - b.x).hypot(a.y - b.y))
                .sum::<f64>()
        })
        .sum()
}
/// Invariant (no sliver block): a block thinner on average than a lot can
/// be (`2 area / perimeter` under `network::MIN_LAND`) lies between a street
/// and the trace of a cut whose street was dropped later (a double of a
/// main street): it rejoins the block of its quarter and phase it touches
/// along the longest seam (at least `MIN_LAND`), whose kind it takes, so no
/// strip of land is parcelled on its own along the street. One that touches
/// none and is under a metre wide on average is the gap between two street
/// ribbons, not land: it goes.
fn rejoin_slivers(blocks: &mut Vec<Block>) {
    let thin = |s: &Shape| 2.0 * g::area(s) < network::MIN_LAND * perimeter(s);
    let slit = |s: &Shape| 2.0 * g::area(s) < perimeter(s);
    let mut boxes: Vec<_> = blocks.iter().map(|b| g::bbox(&b.shape)).collect();
    let mut gone = vec![false; blocks.len()];
    for i in 0..blocks.len() {
        if gone[i] || !thin(&blocks[i].shape) {
            continue;
        }
        let bb = boxes[i];
        let own = perimeter(&blocks[i].shape);
        let best = (0..blocks.len())
            .filter(|&j| {
                let o = boxes[j];
                j != i
                    && !gone[j]
                    && blocks[j].quarter == blocks[i].quarter
                    && blocks[j].phase == blocks[i].phase
                    && o.0 <= bb.2 + 0.5
                    && bb.0 <= o.2 + 0.5
                    && o.1 <= bb.3 + 0.5
                    && bb.1 <= o.3 + 0.5
            })
            .filter_map(|j| {
                let mut merged = g::union(&[blocks[j].shape.clone(), blocks[i].shape.clone()]);
                if merged.len() != 1 {
                    return None;
                }
                let shape = merged.pop()?;
                let seam = 0.5 * (own + perimeter(&blocks[j].shape) - perimeter(&shape));
                (seam >= network::MIN_LAND).then_some((j, seam, shape))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)));
        if let Some((j, _, shape)) = best {
            blocks[j].shape = shape;
            boxes[j] = g::bbox(&blocks[j].shape);
            gone[i] = true;
        } else if slit(&blocks[i].shape) {
            gone[i] = true;
        }
    }
    let mut index = 0;
    blocks.retain(|_| {
        index += 1;
        !gone[index - 1]
    });
}

/// Observe frontage to the retained street network; its physical validity was
/// checked upstream. A carved street can face a hole boundary as well as the
/// outer boundary. A hole alone supplies no access and does not create a street.
fn block_boundary_served(shape: &Shape, streets: &[Street], all: &Bins, reach: f64) -> bool {
    // A trimmed street may front the middle of a long edge or hole, without
    // reaching any polygon vertex. Query along edges, then test exact contact.
    std::iter::once(&shape.outer).chain(&shape.holes).any(|ring| {
        ring.iter().zip(ring.iter().cycle().skip(1)).any(|(&a,&b)| {
            let n = ((b.x-a.x).hypot(b.y-a.y)/reach.max(1.)).ceil().max(1.) as usize;
            (0..=n).any(|k| {
                let t = k as f64/n as f64;
                let p = Point{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
                all.around(p, reach).any(|(i, j)| {
                    let s = &streets[i];
                    let (c,d) = (s.path[j],s.path[j+1]);
                    let distance = g::distance(a,c,d).0.min(g::distance(b,c,d).0)
                        .min(g::distance(c,a,b).0).min(g::distance(d,a,b).0);
                    g::segment_hit(a,b,c,d).is_some() || distance <= s.widths[j].max(s.widths[j+1])*0.5+2.
                })
            })
        })
    })
}

#[cfg(test)]
#[path = "blocks_tests.rs"]
mod blocks_tests;

#[cfg(test)]
#[path = "../pnw_block_boundary_tests.rs"]
mod pnw_block_boundary_tests;
