use std::cmp::Ordering;

use magna_urbis_geom::{Point, distance, segment_hit};

use crate::{spec::CharterSpec, survey::Survey};

#[derive(Default)]
pub(super) struct RoadFacts {
    pub(super) nearby: bool,
    pub(super) crossing: Option<Point>,
    pub(super) ford: Option<Point>,
    pub(super) bridge: Option<Point>,
}

impl RoadFacts {
    pub(super) fn inspect(
        roads: &[Vec<Point>],
        survey: &Survey,
        radius: Option<f64>,
        spec: &CharterSpec,
    ) -> Self {
        let center = survey.center();
        let reach = radius.map_or(spec.regional_road_reach, |r| {
            r.min(spec.regional_road_reach)
        });
        let mut facts = Self::default();
        let mut previous = Vec::new();
        for road in roads {
            let mut segments = Vec::new();
            let mut run = WaterRun::default();
            let mut station = 0.0;
            for pair in road.windows(2) {
                let [a, b] = [pair[0], pair[1]];
                let length = a.distance(b);
                if !length.is_finite() {
                    run.clear();
                    continue;
                }
                if length == 0.0 {
                    continue;
                }
                let (offset, t, nearest) = distance(center, a, b);
                if offset > reach {
                    run.clear();
                    station += length;
                    continue;
                }
                facts.nearby |= survey.cell_at(nearest).is_some();
                for &[c, d] in &previous {
                    // The segment test omits its first endpoint. Try both
                    // directions so a T-junction also counts as a crossing.
                    if let Some((_, p)) =
                        segment_hit(a, b, c, d).or_else(|| segment_hit(b, a, c, d))
                        && p.distance(center) <= reach
                        && !survey.closed_at(p)
                    {
                        keep_nearer(&mut facts.crossing, center, p);
                    }
                }
                segments.push([a, b]);

                // Inspect only the local section of long roads. Runs carry
                // through vertices so splitting a road does not hide water.
                let from = (t * length - reach).max(0.0);
                let to = (t * length + reach).min(length);
                let steps = ((to - from) / (survey.cell_size() * 0.5)).ceil().max(1.0) as usize;
                if from > 0.0 {
                    run.clear();
                }
                for i in 0..=steps {
                    let along = from + (to - from) * i as f64 / steps as f64;
                    let fraction = along / length;
                    let p = Point {
                        x: a.x + (b.x - a.x) * fraction,
                        y: a.y + (b.y - a.y) * fraction,
                    };
                    if p.distance(center) > reach {
                        run.clear();
                        continue;
                    }
                    let Some(cell) = survey.cell_at(p) else {
                        run.clear();
                        continue;
                    };
                    let sample = Sample {
                        point: p,
                        station: station + along,
                    };
                    if cell.wet {
                        run.wet(sample, cell.navigable);
                    } else if !survey.closed_at(p) {
                        if let Some((p, width, navigable)) = run.dry(sample) {
                            if width <= spec.ford_max_span && !navigable {
                                keep_nearer(&mut facts.ford, center, p);
                            }
                            if width <= spec.bridge_max_span {
                                keep_nearer(&mut facts.bridge, center, p);
                            }
                        }
                    } else {
                        run.clear();
                    }
                }
                if to < length {
                    run.clear();
                }
                station += length;
            }
            previous.extend(segments);
        }
        facts
    }
}

pub(super) fn nearer(center: Point, a: Point, b: Point) -> Ordering {
    center
        .distance(a)
        .total_cmp(&center.distance(b))
        .then(a.x.total_cmp(&b.x))
        .then(a.y.total_cmp(&b.y))
}

fn keep_nearer(best: &mut Option<Point>, center: Point, candidate: Point) {
    if best.is_none_or(|other| nearer(center, candidate, other).is_lt()) {
        *best = Some(candidate);
    }
}

#[derive(Clone, Copy)]
struct Sample {
    point: Point,
    station: f64,
}

/// The sampled water span between two open banks on a regional polyline.
#[derive(Default)]
struct WaterRun {
    bank: Option<Sample>,
    water: Vec<Sample>,
    navigable: bool,
}

impl WaterRun {
    fn wet(&mut self, sample: Sample, navigable: bool) {
        if self.bank.is_some() {
            self.water.push(sample);
            self.navigable |= navigable;
        }
    }

    fn dry(&mut self, sample: Sample) -> Option<(Point, f64, bool)> {
        let previous_bank = self.bank.replace(sample);
        let span = previous_bank
            .zip(self.water.first())
            .zip(self.water.last())
            .map(|((bank, first), last)| {
                let start = (bank.station + first.station) * 0.5;
                let end = (sample.station + last.station) * 0.5;
                let middle = (start + end) * 0.5;
                let point = match self.water.partition_point(|s| s.station < middle) {
                    0 => first.point,
                    i if i == self.water.len() => last.point,
                    i => {
                        let [a, b] = [self.water[i - 1], self.water[i]];
                        let t = (middle - a.station) / (b.station - a.station);
                        Point {
                            x: a.point.x + (b.point.x - a.point.x) * t,
                            y: a.point.y + (b.point.y - a.point.y) * t,
                        }
                    }
                };
                (point, end - start, self.navigable)
            });
        self.water.clear();
        self.navigable = false;
        span
    }

    fn clear(&mut self) {
        self.bank = None;
        self.water.clear();
        self.navigable = false;
    }
}
