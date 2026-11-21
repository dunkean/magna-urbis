use std::collections::BTreeMap;

use magna_urbis_geom::{Point, distance, surface::TerrainView};

use super::{
    BankId, HarbourFront, SurveySpec, cost::land_distances, grid::Grid, in_terrain, interpolate,
    offset, shelter,
};

struct Node {
    dry: usize,
    wet: usize,
    point: Point,
}

#[derive(Clone, Copy)]
struct Segment {
    from: usize,
    to: usize,
    bank: BankId,
}

#[derive(Default)]
struct Shore {
    nodes: Vec<Node>,
    segments: Vec<Segment>,
}

pub(super) fn fronts(
    grid: &Grid,
    terrain: &dyn TerrainView,
    spec: &SurveySpec,
) -> Vec<HarbourFront> {
    if spec.harbour_reach == 0.0 || !grid.cells.iter().any(|cell| cell.navigable) {
        return Vec::new();
    }

    let shore = trace_shore(grid, terrain);
    let mut land = None;
    let mut fronts = Vec::new();
    let mut bank = None;
    let mut station = 0.0;
    for trace in shore.traces() {
        let first = shore.segments[trace[0]];
        if bank != Some(first.bank) {
            station = 0.0;
            bank = Some(first.bank);
        }
        let mut samples: Vec<_> = trace
            .iter()
            .map(|&i| {
                let segment = shore.segments[i];
                let length = shore.nodes[segment.from]
                    .point
                    .distance(shore.nodes[segment.to].point);
                let start = station;
                station += length;
                (
                    segment,
                    start,
                    length,
                    shore.usable(segment, grid, terrain, spec),
                )
            })
            .collect();
        let last = shore.segments[*trace.last().expect("shore trace is nonempty")];
        if first.from == last.to
            && let Some(gap) = samples.iter().position(|sample| !sample.3)
        {
            // A usable run on a closed shore can continue across station zero.
            samples.rotate_left(gap);
        }
        for run in samples
            .split(|sample| !sample.3)
            .filter(|run| !run.is_empty())
        {
            let length = run.iter().map(|sample| sample.2).sum();
            if length < spec.harbour_min_front {
                continue;
            }
            let path: Vec<_> = std::iter::once(shore.nodes[run[0].0.from].point)
                .chain(run.iter().map(|sample| shore.nodes[sample.0.to].point))
                .collect();
            let Some((shelter_score, sheltered)) = shelter::score(terrain, &path, length) else {
                continue;
            };
            let distances = land.get_or_insert_with(|| land_distances(grid, spec));
            let land_distance = run
                .iter()
                .flat_map(|&(segment, _, _, _)| {
                    let (a, b) = (&shore.nodes[segment.from], &shore.nodes[segment.to]);
                    [a.dry, b.dry].map(|i| {
                        distances[i] + distance(grid.cells[i].position, a.point, b.point).0
                    })
                })
                .filter(|d| d.is_finite())
                .min_by(f64::total_cmp);
            fronts.push(HarbourFront {
                bank_id: first.bank,
                station: run[0].1,
                shore: path,
                length,
                shelter_score,
                sheltered,
                land_distance,
            });
        }
    }
    fronts.sort_unstable_by(|a, b| {
        a.bank_id
            .cmp(&b.bank_id)
            .then(a.station.total_cmp(&b.station))
    });
    fronts
}

// March the wet/dry contours between cell centres. In a checkerboard quad,
// route each segment around its dry corner so four-connected banks stay apart.
fn trace_shore(grid: &Grid, terrain: &dyn TerrainView) -> Shore {
    let mut shore = Shore::default();
    let mut seen = BTreeMap::new();
    for y in 1..grid.rows {
        for x in 1..grid.columns {
            let nw = (y - 1) * grid.columns + x - 1;
            let corners = [nw, nw + 1, nw + grid.columns + 1, nw + grid.columns];
            if corners.iter().any(|&i| !grid.cells[i].surveyed) {
                continue;
            }
            let wet = corners.map(|i| grid.cells[i].wet);
            let mut crossings = [None; 4];
            for k in 0..4 {
                let next = (k + 1) % 4;
                if wet[k] == wet[next] {
                    continue;
                }
                let (dry, water) = if wet[k] {
                    (corners[next], corners[k])
                } else {
                    (corners[k], corners[next])
                };
                crossings[k] = Some(*seen.entry((dry, water)).or_insert_with(|| {
                    let index = shore.nodes.len();
                    let mut a = grid.cells[dry].position;
                    let mut b = grid.cells[water].position;
                    // Keep the dry limit so elevation at a vertex belongs to the bank.
                    for _ in 0..8 {
                        let middle = interpolate(a, b, 0.5);
                        if terrain.wet(middle) {
                            b = middle;
                        } else {
                            a = middle;
                        }
                    }
                    shore.nodes.push(Node {
                        dry,
                        wet: water,
                        point: a,
                    });
                    index
                }));
            }
            let checkerboard = crossings.iter().all(Option::is_some);
            for (k, from) in crossings.into_iter().enumerate() {
                let Some(from) = from.filter(|_| !wet[k]) else {
                    continue;
                };
                let to = if checkerboard {
                    crossings[(k + 3) % 4]
                } else {
                    crossings
                        .iter()
                        .enumerate()
                        .find_map(|(i, &node)| if wet[i] { node } else { None })
                };
                if let (Some(to), Some(bank)) = (to, grid.cells[corners[k]].bank_id) {
                    shore.segments.push(Segment { from, to, bank });
                }
            }
        }
    }
    shore
}

impl Shore {
    fn traces(&self) -> Vec<Vec<usize>> {
        let mut next = vec![None; self.nodes.len()];
        let mut incoming = vec![false; self.nodes.len()];
        for (i, segment) in self.segments.iter().enumerate() {
            next[segment.from] = Some(i);
            incoming[segment.to] = true;
        }
        let mut starts: Vec<_> = (0..self.segments.len()).collect();
        starts.sort_unstable_by_key(|&i| {
            let s = self.segments[i];
            let node = &self.nodes[s.from];
            (s.bank, incoming[s.from], node.dry, node.wet)
        });
        let mut traces = Vec::new();
        let mut seen = vec![false; self.segments.len()];
        for start in starts {
            if seen[start] {
                continue;
            }
            let mut trace = Vec::new();
            let mut current = Some(start);
            while let Some(i) = current.filter(|&i| !seen[i]) {
                seen[i] = true;
                trace.push(i);
                current = next[self.segments[i].to];
            }
            traces.push(trace);
        }
        traces
    }

    fn usable(
        &self,
        segment: Segment,
        grid: &Grid,
        terrain: &dyn TerrainView,
        spec: &SurveySpec,
    ) -> bool {
        let (a, b) = (&self.nodes[segment.from], &self.nodes[segment.to]);
        let length = a.point.distance(b.point);
        if length <= f64::EPSILON
            || [a, b].iter().any(|node| {
                grid.cells[node.dry].closed
                    || !grid.cells[node.wet].navigable
                    || node.point.distance(grid.center) > spec.harbour_reach
                    || grid.restricted(node.point)
            })
            || (terrain.height_at(a.point) - terrain.height_at(b.point)).abs()
                > spec.harbour_bank_grade * length
        {
            return false;
        }

        let inland = Point {
            x: (a.point.y - b.point.y) / length,
            y: (b.point.x - a.point.x) / length,
        };
        let middle = interpolate(a.point, b.point, 0.5);
        if grid.restricted(middle) {
            return false;
        }
        let land = |p| in_terrain(p, grid.width) && !terrain.wet(p);
        let behind = |p, d| offset(p, inland.x * d, inland.y * d);
        let Some(bank) = [0.5, 1.0, 2.0, 4.0]
            .into_iter()
            .map(|d| behind(middle, d))
            .find(|&p| land(p))
        else {
            return false;
        };

        // A quay and its landing rows need a strip of gentle, continuous land.
        let mut height = terrain.height_at(bank);
        if !height.is_finite() {
            return false;
        }
        for step in 1..=5 {
            let d = 12.0 * f64::from(step);
            let next = behind(bank, d);
            if !land(behind(bank, d - 6.0)) || !land(next) {
                return false;
            }
            let next_height = terrain.height_at(next);
            if !next_height.is_finite()
                || (height - next_height).abs() > 12.0 * spec.harbour_bank_grade
            {
                return false;
            }
            height = next_height;
        }

        // A water code identifies the kind of water, but even a lake shore
        // needs an unbroken channel of usable width directly off the bank.
        let wet = |d| {
            let p = behind(middle, -d);
            in_terrain(p, grid.width) && terrain.wet(p)
        };
        let Some(start) = [0.5, 1.0, 2.0, 4.0].into_iter().find(|&d| wet(d)) else {
            return false;
        };
        let steps = (spec.navigable_width / 2.0).ceil() as usize;
        (1..steps).all(|k| wet(start + spec.navigable_width * k as f64 / steps as f64))
    }
}
