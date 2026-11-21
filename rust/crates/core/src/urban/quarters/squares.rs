//! Market, gate and crossroads squares chosen from carved blocks.

use super::street_index::Bins;
use crate::rng::Rng;
use crate::urban::{Block, Morph, Point, Street, geometry as g, par};

/// Intentional public squares, chosen among whole blocks so no parcel is cut:
/// the market place at each centre (sized by population, on a main street), and
/// the cultural `gatePlaces` / `crossPlaces` chances at gates and at crossings
/// of main streets. Leftover places from the cuts remain a secondary source.
pub(super) fn squares(
    blocks: &mut [Block],
    streets: &[Street],
    centres: &[(Point, f64)],
    gates: &[Point],
    population: u32,
    m: &Morph,
    rng: &mut Rng,
) {
    if blocks.is_empty() || population < 300 {
        return;
    }
    let mut major = Bins::new(40.0, 1);
    major.sync(streets);
    let fronts_major = |b: &Block| {
        let reach = g::area(&b.shape).sqrt() * 0.75 + 6.0;
        major
            .nearest(g::interior_point(&b.shape), streets, 1, reach)
            .is_some()
    };
    let free = |b: &Block| b.kind == "block";
    // Interior point and area of every block, once (in parallel); the
    // squares only change kinds.
    let sites: Vec<(Point, f64)> = par::map(blocks, |_, b| (g::interior_point(&b.shape), g::area(&b.shape)));
    // Blocks by interior point on a 50 m grid (the small-square reaches are below it).
    const SITE_CELL: f64 = 50.0;
    let site_cell = |p: Point| ((p.x / SITE_CELL).floor() as i64, (p.y / SITE_CELL).floor() as i64);
    let mut site_grid: std::collections::HashMap<(i64, i64), Vec<usize>> = Default::default();
    for (i, &(c, _)) in sites.iter().enumerate() {
        site_grid.entry(site_cell(c)).or_default().push(i);
    }
    // Market area grows with the town, from a village green to a 1.2 ha square.
    let market = (300.0 + 0.2 * population as f64).clamp(500.0, 12_000.0);
    for (k, &(centre, weight)) in centres.iter().enumerate() {
        let target = if k == 0 {
            market
        } else {
            (market * weight.sqrt()).max(400.0)
        };
        let reach = 2.5 * target.sqrt() + 60.0;
        let best = blocks
            .iter()
            .enumerate()
            .filter(|(_, b)| free(b))
            .filter_map(|(i, b)| {
                let (c, area) = sites[i];
                let d = (c.x - centre.x).hypot(c.y - centre.y);
                (d < reach && (0.35..=2.5).contains(&(area / target)) && fronts_major(b))
                    .then(|| (i, (area / target).ln().abs() + d / reach))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        if let Some((i, _)) = best {
            blocks[i].kind = "place".into();
        }
    }
    // Nearest free small block within `reach` (< `SITE_CELL`), lowest index
    // on a tie: only the blocks in the 3 x 3 cells round `p` can be.
    let nearest_small = |blocks: &[Block], p: Point, reach: f64, hi: f64| {
        let (cx, cy) = site_cell(p);
        (cx - 1..=cx + 1)
            .flat_map(|x| (cy - 1..=cy + 1).map(move |y| (x, y)))
            .flat_map(|c| site_grid.get(&c).into_iter().flatten().copied())
            .filter(|&i| free(&blocks[i]) && (120.0..=hi).contains(&sites[i].1))
            .map(|i| {
                let c = sites[i].0;
                (i, (c.x - p.x).hypot(c.y - p.y))
            })
            .filter(|(_, d)| *d < reach)
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
            .map(|v| v.0)
    };
    let gate_chance = m.number("gatePlaces");
    for &gate in gates {
        if rng.chance(gate_chance)
            && let Some(i) = nearest_small(blocks, gate, 45.0, 2_500.0)
        {
            blocks[i].kind = "place".into();
        }
    }
    let cross_chance = m.number("crossPlaces");
    if cross_chance > 0.0 {
        // Junctions where at least three main-street arms meet.
        let mut arms: std::collections::BTreeMap<(i64, i64), (Point, usize)> = Default::default();
        for s in streets.iter().filter(|s| s.rank <= 1) {
            for (j, &p) in s.path.iter().enumerate() {
                let ends = usize::from(j > 0) + usize::from(j + 1 < s.path.len());
                let key = ((p.x * 100.0).round() as i64, (p.y * 100.0).round() as i64);
                arms.entry(key).or_insert((p, 0)).1 += ends;
            }
        }
        let mut done: Vec<Point> = vec![];
        for (_, (p, count)) in arms {
            if count < 3 || done.iter().any(|q| (q.x - p.x).hypot(q.y - p.y) < 150.0) {
                continue;
            }
            if rng.chance(cross_chance)
                && let Some(i) = nearest_small(blocks, p, 35.0, 1_500.0)
            {
                blocks[i].kind = "place".into();
                done.push(p);
            }
        }
    }
}
