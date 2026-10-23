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
}
