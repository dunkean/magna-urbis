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
        let mut result = Self {
            land_index: land.iter().map(g::ContainmentIndex::new).collect(),
            water_index: water.iter().map(g::ContainmentIndex::new).collect(),
            land,
            water,
            edges: vec![],
            bins: BTreeMap::new(),
            cell: width / 64.0,
            states: vec![],
            fine: (width / 1024.0).max(2.0),
            side: 0,
        };
        result.side = (width / result.fine).ceil() as usize;
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
        Ok(result)
    }
    fn exact_wet(&self, p: Point) -> bool {
        !self.land_index.iter().any(|s| s.contains(p))
            || self.water_index.iter().any(|s| s.contains(p))
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
        for water in &self.water {
            land = land
                .into_iter()
                .flat_map(|s| g::difference(&s, water))
                .collect();
        }
        land
    }
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
    #[allow(dead_code)]
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
