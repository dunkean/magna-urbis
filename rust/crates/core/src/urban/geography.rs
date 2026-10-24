//! Retained vector land and physical water, shared by both urban benches.
use super::{Point, Shape, geometry as g};
use geo::BooleanOps;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct VectorGeography {
    pub land: Vec<Vec<Point>>,
    /// Each path is an even/odd group; overlapping channels are then united.
    pub water: Vec<Vec<Vec<Point>>>,
}
pub struct Geography {
    land: Vec<Shape>,
    water: Vec<Shape>,
    land_index: Vec<g::ContainmentIndex>,
    water_index: Vec<g::ContainmentIndex>,
    edges: Vec<(Point, Point)>,
    bins: BTreeMap<(i64, i64), Vec<usize>>,
    /// Water shapes by coarse bin of their box: a tiled shoreline holds
    /// thousands of pieces, and a point or a clip only meets a few.
    water_bins: BTreeMap<(i64, i64), Vec<usize>>,
    cell: f64,
    /// Fine cells: 3 = crossed by a land/water edge (exact test), 0 = not yet
    /// known, 1 = dry, 2 = wet. A cell no edge crosses lies wholly on one side,
    /// so its first exact answer holds for every point inside it.
    states: Vec<std::sync::atomic::AtomicU8>,
    fine: f64,
    side: usize,
}
fn even_odd(rings: Vec<Vec<Point>>) -> Vec<Shape> {
    let mut land = geo::MultiPolygon(vec![]);
    for outer in rings.into_iter().filter(|r| r.len() >= 3) {
        land = land.xor(&g::polygon(&g::normalized(Shape {
            outer,
            holes: vec![],
        })));
    }
    g::shapes(land)
}
impl Geography {
    pub fn new(input: VectorGeography, width: f64) -> Result<Self, String> {
        let rings = input.land.iter().chain(input.water.iter().flatten());
        let mut count = 0;
        for ring in rings {
            count += ring.len();
            if count > 1_000_000
                || ring.iter().any(|p| {
                    !p.x.is_finite()
                        || !p.y.is_finite()
                        || p.x.abs() > width * 4.0
                        || p.y.abs() > width * 4.0
                })
            {
                return Err("Géographie vectorielle invalide".into());
            }
        }
        let land = even_odd(input.land);
        let water = g::union(
            &input
                .water
                .into_iter()
                .flat_map(even_odd)
                .collect::<Vec<_>>(),
        );
        Ok(Self::build(land, water, width))
    }
    /// Index already resolved land and water shapes. Water shapes may share
    /// edges (tiles of one body); containment and clipping treat them as a union.
    fn build(land: Vec<Shape>, water: Vec<Shape>, width: f64) -> Self {
        let mut result = Self {
            land_index: land.iter().map(g::ContainmentIndex::new).collect(),
            water_index: water.iter().map(g::ContainmentIndex::new).collect(),
            land,
            water,
            edges: vec![],
            bins: BTreeMap::new(),
            water_bins: BTreeMap::new(),
            cell: width / 64.0,
            states: vec![],
            fine: (width / 1024.0).max(2.0),
            side: 0,
        };
        result.side = (width / result.fine).ceil() as usize;
        for (id, w) in result.water.iter().enumerate() {
            let (x0, y0, x1, y1) = g::bbox(w);
            for y in (y0 / result.cell).floor() as i64..=(y1 / result.cell).floor() as i64 {
                for x in (x0 / result.cell).floor() as i64..=(x1 / result.cell).floor() as i64 {
                    result.water_bins.entry((x, y)).or_default().push(id);
                }
            }
        }
        result.states = (0..result.side * result.side)
            .map(|_| std::sync::atomic::AtomicU8::new(0))
            .collect();
        for s in result.land.iter().chain(&result.water) {
            for ring in std::iter::once(&s.outer).chain(&s.holes) {
                for (&a, &b) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    let id = result.edges.len();
                    result.edges.push((a, b));
                    // Conservative: the sampled cells and their neighbours.
                    let steps =
                        ((a.x - b.x).hypot(a.y - b.y) / (result.fine * 0.5)).ceil() as usize;
                    for k in 0..=steps.max(1) {
                        let t = k as f64 / steps.max(1) as f64;
                        let cx = ((a.x + (b.x - a.x) * t) / result.fine).floor() as i64;
                        let cy = ((a.y + (b.y - a.y) * t) / result.fine).floor() as i64;
                        for y in cy - 1..=cy + 1 {
                            for x in cx - 1..=cx + 1 {
                                if (0..result.side as i64).contains(&x)
                                    && (0..result.side as i64).contains(&y)
                                {
                                    result.states[y as usize * result.side + x as usize]
                                        .store(3, std::sync::atomic::Ordering::Relaxed);
                                }
                            }
                        }
                    }
                    for y in (a.y.min(b.y) / result.cell).floor() as i64
                        ..=(a.y.max(b.y) / result.cell).floor() as i64
                    {
                        for x in (a.x.min(b.x) / result.cell).floor() as i64
                            ..=(a.x.max(b.x) / result.cell).floor() as i64
                        {
                            result.bins.entry((x, y)).or_default().push(id);
                        }
                    }
                }
            }
        }
        result
    }
    /// This geography as the surface's water; height and raster stay.
    pub(super) fn surface<'a>(&'a self, s: super::Surface<'a>) -> super::Surface<'a> {
        super::Surface {
            geometry: Some(self),
            ..s
        }
    }
    fn exact_wet(&self, p: Point) -> bool {
        let bin = (
            (p.x / self.cell).floor() as i64,
            (p.y / self.cell).floor() as i64,
        );
        !self.land_index.iter().any(|s| s.contains(p))
            || self
                .water_bins
                .get(&bin)
                .is_some_and(|ids| ids.iter().any(|&i| self.water_index[i].contains(p)))
    }
    /// Water shapes whose box meets this box, in index order.
    fn water_near(&self, bb: (f64, f64, f64, f64)) -> BTreeSet<usize> {
        let mut ids = BTreeSet::new();
        for y in (bb.1 / self.cell).floor() as i64..=(bb.3 / self.cell).floor() as i64 {
            for x in (bb.0 / self.cell).floor() as i64..=(bb.2 / self.cell).floor() as i64 {
                if let Some(bin) = self.water_bins.get(&(x, y)) {
                    ids.extend(bin);
                }
            }
        }
        ids.retain(|&i| {
            let w = g::bbox(&self.water[i]);
            w.0 <= bb.2 && w.2 >= bb.0 && w.1 <= bb.3 && w.3 >= bb.1
        });
        ids
    }
    pub(super) fn wet(&self, p: Point) -> bool {
        use std::sync::atomic::Ordering::Relaxed;
        let (x, y) = ((p.x / self.fine).floor(), (p.y / self.fine).floor());
        if x < 0.0 || y < 0.0 || x >= self.side as f64 || y >= self.side as f64 {
            return self.exact_wet(p);
        }
        let state = &self.states[y as usize * self.side + x as usize];
        match state.load(Relaxed) {
            1 => false,
            2 => true,
            3 => self.exact_wet(p),
            _ => {
                let wet = self.exact_wet(p);
                state.store(if wet { 2 } else { 1 }, Relaxed);
                wet
            }
        }
    }
    fn candidates(&self, bb: (f64, f64, f64, f64)) -> BTreeSet<usize> {
        let mut ids = BTreeSet::new();
        for y in (bb.1 / self.cell).floor() as i64..=(bb.3 / self.cell).floor() as i64 {
            for x in (bb.0 / self.cell).floor() as i64..=(bb.2 / self.cell).floor() as i64 {
                if let Some(bin) = self.bins.get(&(x, y)) {
                    ids.extend(bin);
                }
            }
        }
        ids
    }
    /// Whether no land/water edge can cross the segment: every half-cell sample
    /// lies in a cell no edge comes within about one cell of.
    fn uniform_segment(&self, a: Point, b: Point) -> bool {
        let steps = ((a.x - b.x).hypot(a.y - b.y) / (self.fine * 0.5)).ceil() as usize;
        (0..=steps.max(1)).all(|k| {
            let t = k as f64 / steps.max(1) as f64;
            let (x, y) = (
                ((a.x + (b.x - a.x) * t) / self.fine).floor(),
                ((a.y + (b.y - a.y) * t) / self.fine).floor(),
            );
            x >= 0.0
                && y >= 0.0
                && x < self.side as f64
                && y < self.side as f64
                && self.states[y as usize * self.side + x as usize]
                    .load(std::sync::atomic::Ordering::Relaxed)
                    != 3
        })
    }
    pub(super) fn segment_dry(&self, a: Point, b: Point) -> bool {
        if self.uniform_segment(a, b) {
            return !self.wet(a);
        }
        let mut cuts = vec![0.0, 1.0];
        for i in self.candidates((a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y))) {
            let (c, d) = self.edges[i];
            if let Some((t, _)) = g::segment_hit(a, b, c, d) {
                cuts.push(t);
            }
        }
        cuts.sort_by(f64::total_cmp);
        cuts.windows(2).filter(|p| p[1] - p[0] > 1e-9).all(|t| {
            let t = (t[0] + t[1]) * 0.5;
            !self.wet(Point {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            })
        })
    }
    pub(super) fn clip(&self, shape: &Shape) -> Vec<Shape> {
        let bb = g::bbox(shape);
        let nearby = self.candidates(bb).into_iter().any(|i| {
            let (a, b) = self.edges[i];
            a.x.min(b.x) <= bb.2
                && a.x.max(b.x) >= bb.0
                && a.y.min(b.y) <= bb.3
                && a.y.max(b.y) >= bb.1
        });
        if !nearby {
            return if self.wet(g::interior_point(shape)) {
                vec![]
            } else {
                vec![shape.clone()]
            };
        }
        let mut land: Vec<_> = self
            .land
            .iter()
            .flat_map(|s| g::intersection(shape, s))
            .collect();
        for i in self.water_near(bb) {
            land = land
                .into_iter()
                .flat_map(|s| g::difference(&s, &self.water[i]))
                .collect();
        }
        land
    }
}

/// Contour level of the raster water: the share of the four cells around a
/// cell corner that are wet. Below a quarter every wet cell lies wholly inside
/// the contour, so the smoothed shore never puts raster water on land; it
/// gives up at most 0.6 of a cell of bank.
const SHORE_LEVEL: f64 = 0.2;
/// Cells per side of a shoreline tile: bounded overlay work per union.
const SHORE_TILE: usize = 32;

/// The water of a raster-only surface as its contour at the cell scale
/// (marching squares on the cell corners). Shores, and the blocks and lots
/// clipped against them, then follow the bank instead of the raster's
/// right-angle staircase. None when vector geography exists or nothing is wet.
pub(super) fn raster_shoreline(surface: &super::Surface<'_>) -> Option<Geography> {
    let n = surface.n;
    if surface.geometry.is_some() || n == 0 || !surface.water.iter().any(|&w| w != 0) {
        return None;
    }
    let cell = surface.width / n as f64;
    let wet = |x: usize, y: usize| surface.water[y * n + x] != 0;
    // Corner (a, b) touches cells a-1..=a by b-1..=b (those inside the raster).
    let level: Vec<f64> = (0..(n + 1) * (n + 1))
        .map(|i| {
            let (a, b) = (i % (n + 1), i / (n + 1));
            let (mut count, mut total) = (0usize, 0usize);
            for y in b.saturating_sub(1)..(b + 1).min(n) {
                for x in a.saturating_sub(1)..(a + 1).min(n) {
                    total += 1;
                    count += wet(x, y) as usize;
                }
            }
            count as f64 / total as f64
        })
        .collect();
    let corner = |a: usize, b: usize| Point {
        x: a as f64 * cell,
        y: b as f64 * cell,
    };
    let mut water = vec![];
    for ty in (0..n).step_by(SHORE_TILE) {
        for tx in (0..n).step_by(SHORE_TILE) {
            let mut pieces = vec![];
            for y in ty..(ty + SHORE_TILE).min(n) {
                let mut run: Option<usize> = None;
                for x in tx..=(tx + SHORE_TILE).min(n) {
                    let corners = [(x, y), (x + 1, y), (x + 1, y + 1), (x, y + 1)];
                    let full = x < (tx + SHORE_TILE).min(n)
                        && corners
                            .iter()
                            .all(|&(a, b)| level[b * (n + 1) + a] > SHORE_LEVEL);
                    if full {
                        run.get_or_insert(x);
                        continue;
                    }
                    if let Some(start) = run.take() {
                        pieces.push(g::rectangle(
                            start as f64 * cell,
                            y as f64 * cell,
                            x as f64 * cell,
                            (y + 1) as f64 * cell,
                        ));
                    }
                    if x == (tx + SHORE_TILE).min(n) {
                        break;
                    }
                    let v = corners.map(|(a, b)| level[b * (n + 1) + a]);
                    let inside = v.map(|v| v > SHORE_LEVEL);
                    if !inside.iter().any(|&i| i) {
                        continue;
                    }
                    let p = corners.map(|(a, b)| corner(a, b));
                    let cross = |k: usize| {
                        let j = (k + 1) % 4;
                        let t = (SHORE_LEVEL - v[k]) / (v[j] - v[k]);
                        Point {
                            x: p[k].x + (p[j].x - p[k].x) * t,
                            y: p[k].y + (p[j].y - p[k].y) * t,
                        }
                    };
                    // A dry cell between two diagonal wet corners keeps them
                    // apart (a wet cell is always whole).
                    if inside[0] == inside[2] && inside[1] == inside[3] && inside[0] != inside[1] {
                        for k in (0..4).filter(|&k| inside[k]) {
                            pieces.push(Shape {
                                outer: vec![cross((k + 3) % 4), p[k], cross(k)],
                                holes: vec![],
                            });
                        }
                        continue;
                    }
                    let mut outer = vec![];
                    for k in 0..4 {
                        if inside[k] {
                            outer.push(p[k]);
                        }
                        if inside[k] != inside[(k + 1) % 4] {
                            outer.push(cross(k));
                        }
                    }
                    pieces.push(g::normalized(Shape {
                        outer,
                        holes: vec![],
                    }));
                }
            }
            if !pieces.is_empty() {
                water.extend(g::union(&pieces));
            }
        }
    }
    Some(Geography::build(
        vec![g::rectangle(0.0, 0.0, surface.width, surface.width)],
        water,
        surface.width,
    ))
}

/// Ground of a stilt settlement (catalogue `render.stilts`: lagoon and marsh
/// folk): the town stands on its shore, its centre moved to the nearest bank
/// within reach, and the shallow water within `reach` of dry land counts as
/// ground, so its walkways and houses on piles extend over the water, always
/// joined to the land. Other cultures, and a site with no shore within
/// reach, keep the ordinary ground (None).
pub(super) struct StiltGround {
    pub site: super::Site,
    water: Vec<u8>,
}
impl StiltGround {
    /// The raster ground with the stilt water dry (the vector geography, if
    /// any, is replaced by this raster, which samples it). For
    /// `generate_quarters`, plan and programme alike (OPUS_CITY.md request).
    pub fn surface<'a>(&'a self, s: super::Surface<'a>) -> super::Surface<'a> {
        super::Surface {
            geometry: None,
            water: &self.water,
            ..s
        }
    }
}
/// Water a stilt town builds over, from the shore (m): half the town radius.
fn stilt_reach(radius: f64) -> f64 {
    (0.5 * radius).clamp(40.0, 160.0)
}
pub(super) fn stilt_ground(
    site: &super::Site,
    culture: &str,
    surface: super::Surface<'_>,
) -> Option<StiltGround> {
    if super::catalogue()["cultures"][culture]["render"]["stilts"].as_bool() != Some(true)
        || surface.n < 2
        || surface.wet(site.center)
    {
        return None;
    }
    let n = surface.n as i64;
    let cell = surface.width / surface.n as f64;
    let centre = |i: i64, j: i64| Point {
        x: (i as f64 + 0.5) * cell,
        y: (j as f64 + 0.5) * cell,
    };
    let at = |p: Point| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64);
    let dist = |a: Point, b: Point| (a.x - b.x).hypot(a.y - b.y);
    // The nearest water within reach of the site (two radii, at least 400 m).
    let search = (2.0 * site.radius).max(400.0);
    let (ci, cj) = at(site.center);
    let r = (search / cell).ceil() as i64;
    let mut best: Option<(f64, Point)> = None;
    for j in (cj - r).max(0)..=(cj + r).min(n - 1) {
        for i in (ci - r).max(0)..=(ci + r).min(n - 1) {
            let q = centre(i, j);
            let d = dist(q, site.center);
            if d <= search && best.is_none_or(|b| d < b.0) && surface.wet(q) {
                best = Some((d, q));
            }
        }
    }
    let (d, water) = best?;
    let toward = Point {
        x: (site.center.x - water.x) / d.max(1e-9),
        y: (site.center.y - water.y) / d.max(1e-9),
    };
    let bank = (0..=(d / 0.5) as usize)
        .map(|k| Point {
            x: water.x + toward.x * 0.5 * k as f64,
            y: water.y + toward.y * 0.5 * k as f64,
        })
        .find(|&q| !surface.wet(q))?;
    // Wet cells within reach of a dry cell (8-neighbour rings, a window of
    // the town around the bank) become ground; the rest keeps its water.
    let reach = stilt_reach(site.radius);
    let steps = (reach / cell).ceil() as usize;
    let (bi, bj) = at(bank);
    let wr = ((1.5 * site.radius + reach) / cell).ceil() as i64;
    let (i0, j0) = ((bi - wr).max(0), (bj - wr).max(0));
    let (i1, j1) = ((bi + wr).min(n - 1), (bj + wr).min(n - 1));
    let side = (i1 - i0 + 1) as usize;
    let rows = (j1 - j0 + 1) as usize;
    let mut wet = vec![false; side * rows];
    let mut frontier = vec![];
    for j in 0..rows {
        for i in 0..side {
            let w = surface.wet(centre(i0 + i as i64, j0 + j as i64));
            wet[j * side + i] = w;
            if !w {
                frontier.push((i, j));
            }
        }
    }
    let mut water_mask = surface.water.to_vec();
    let mut reached = vec![false; side * rows];
    for _ in 0..steps {
        let mut next = vec![];
        for &(i, j) in &frontier {
            for (di, dj) in [
                (-1i64, -1i64),
                (0, -1),
                (1, -1),
                (-1, 0),
                (1, 0),
                (-1, 1),
                (0, 1),
                (1, 1),
            ] {
                let (x, y) = (i as i64 + di, j as i64 + dj);
                if x < 0 || y < 0 || x >= side as i64 || y >= rows as i64 {
                    continue;
                }
                let k = y as usize * side + x as usize;
                if wet[k] && !reached[k] {
                    reached[k] = true;
                    next.push((x as usize, y as usize));
                }
            }
        }
        frontier = next;
    }
    for j in 0..rows {
        for i in 0..side {
            let g = (j0 as usize + j) * surface.n + i0 as usize + i;
            water_mask[g] = if wet[j * side + i] && !reached[j * side + i] {
                water_mask[g].max(1)
            } else {
                0
            };
        }
    }
    Some(StiltGround {
        site: super::Site {
            center: bank,
            ..site.clone()
        },
        water: water_mask,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::urban::{Surface, routing};
    #[test]
    fn vector_coast_and_thin_river_override_coarse_cells_without_stair_steps() {
        let land = vec![
            Point { x: 0.0, y: 400.0 },
            Point { x: 800.0, y: 200.0 },
            Point { x: 800.0, y: 800.0 },
            Point { x: 0.0, y: 800.0 },
        ];
        let river = g::rectangle(313.0, 450.0, 315.0, 780.0).outer;
        let geometry = Geography::new(
            VectorGeography {
                land: vec![land],
                water: vec![vec![river]],
            },
            800.0,
        )
        .unwrap();
        let h = vec![20.0; 16 * 16];
        let water = vec![0; h.len()];
        let surface = Surface {
            geometry: Some(&geometry),
            width: 800.0,
            n: 16,
            height: &h,
            water: &water,
        };
        let clipped = g::dry_clip(&surface, &g::rectangle(100.0, 100.0, 700.0, 420.0));
        assert_eq!(clipped.len(), 1);
        assert!(clipped[0].outer.len() <= 5);
        assert!(
            clipped[0]
                .outer
                .iter()
                .any(|p| (p.x - 100.0).abs() < 1e-6 && (p.y - 375.0).abs() < 1e-6)
        );
        assert!(!routing::segment_clear(
            surface,
            Point { x: 100.0, y: 600.0 },
            Point { x: 700.0, y: 600.0 },
            0.12
        ));
        assert!(routing::segment_clear(
            surface,
            Point { x: 400.0, y: 600.0 },
            Point { x: 700.0, y: 600.0 },
            0.12
        ));
    }
    /// Right-angle vertices whose neighbour along a short edge is one too:
    /// the raster staircase, not the isolated corners of a clipping box.
    fn staircase(ring: &[Point], short: f64) -> usize {
        let n = ring.len();
        let right = |i: usize| {
            let (a, b, c) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            let axial = |p: Point, q: Point| (p.x - q.x).abs() < 1e-6 || (p.y - q.y).abs() < 1e-6;
            axial(a, b)
                && axial(b, c)
                && ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)).abs() < 1e-6
        };
        (0..n)
            .filter(|&i| {
                right(i)
                    && right((i + 1) % n)
                    && (ring[i].x - ring[(i + 1) % n].x).hypot(ring[i].y - ring[(i + 1) % n].y)
                        < short
            })
            .count()
    }
    /// A raster-only river crossing a block diagonally: the block is clipped
    /// along the contour of the water mask, not its cell staircase, and the
    /// contour holds every wet cell while giving up less than a cell of bank.
    #[test]
    fn raster_water_clips_along_its_contour_not_its_cell_staircase() {
        let (n, width) = (64, 640.0);
        let cell = width / n as f64;
        let water: Vec<u8> = (0..n * n)
            .map(|i| u8::from(((i % n) as i64 - (i / n) as i64 / 2 - 16).abs() <= 1))
            .collect();
        let h = vec![10.0; n * n];
        let raster = Surface {
            geometry: None,
            width,
            n,
            height: &h,
            water: &water,
        };
        let block = g::rectangle(100.0, 100.0, 540.0, 540.0);
        let stairs = |shapes: &[Shape]| {
            shapes
                .iter()
                .flat_map(|s| std::iter::once(&s.outer).chain(&s.holes))
                .map(|r| staircase(r, cell * 2.5))
                .sum::<usize>()
        };
        assert!(stairs(&g::dry_clip(&raster, &block)) > 20);
        let shoreline = raster_shoreline(&raster).unwrap();
        let surface = shoreline.surface(raster);
        let clipped = g::dry_clip(&surface, &block);
        assert_eq!(stairs(&clipped), 0);
        for i in 0..n * n {
            let (x, y) = ((i % n) as f64 * cell, (i / n) as f64 * cell);
            let wet = water[i] != 0;
            for (dx, dy) in [
                (0.01, 0.01),
                (0.99, 0.01),
                (0.5, 0.5),
                (0.01, 0.99),
                (0.99, 0.99),
            ] {
                let p = Point {
                    x: x + dx * cell,
                    y: y + dy * cell,
                };
                if wet {
                    assert!(surface.wet(p), "raster water on land at {p:?}");
                    assert!(!clipped.iter().any(|s| g::contains(s, p)));
                }
            }
            // A dry cell with no wet neighbour keeps all of its ground.
            let (cx, cy) = (i % n, i / n);
            let near = (cx.saturating_sub(1)..(cx + 2).min(n))
                .any(|x| (cy.saturating_sub(1)..(cy + 2).min(n)).any(|y| water[y * n + x] != 0));
            if !wet && !near {
                assert!(!surface.wet(Point {
                    x: x + cell * 0.5,
                    y: y + cell * 0.5
                }));
            }
        }
        // Both banks of a 490 m reach give up less than a cell each.
        let area = |shapes: &[Shape]| shapes.iter().map(g::area).sum::<f64>();
        let lost = area(&g::dry_clip(&raster, &block)) - area(&clipped);
        assert!(lost > 0.0 && lost < 2.0 * 490.0 * cell, "bank lost {lost}");
    }
    /// A stilt town moves to its shore and builds over the water within
    /// reach of the land; deeper water and other cultures keep their ground.
    #[test]
    fn a_stilt_town_stands_on_its_shore_over_shallow_water() {
        let n = 200;
        let cell = 1000.0 / n as f64;
        let height = vec![0.0; n * n];
        let water: Vec<u8> = (0..n * n)
            .map(|k| u8::from(((k % n) as f64 + 0.5) * cell > 600.0))
            .collect();
        let surface = Surface {
            geometry: None,
            width: 1000.0,
            n,
            height: &height,
            water: &water,
        };
        let site = crate::urban::Site {
            key: "stilts".into(),
            name: String::new(),
            population: 2000,
            culture: "stilt-town".into(),
            center: Point { x: 400.0, y: 500.0 },
            radius: 120.0,
        };
        let ground = stilt_ground(&site, "stilt-town", surface).unwrap();
        assert!(
            (ground.site.center.x - 600.0).abs() <= cell
                && (ground.site.center.y - 500.0).abs() <= cell
        );
        let s = ground.surface(surface);
        let reach = stilt_reach(site.radius);
        assert!(!s.wet(Point {
            x: 600.0 + reach - 2.0 * cell,
            y: 500.0
        }));
        assert!(s.wet(Point {
            x: 600.0 + reach + 2.0 * cell,
            y: 500.0
        }));
        assert!(stilt_ground(&site, "european-organic", surface).is_none());
    }
}
