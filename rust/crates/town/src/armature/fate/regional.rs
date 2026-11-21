//! Carry source stationing through clipping and seating a road on the founding graph.

use magna_urbis_geom::Point;

use super::super::{Draw, Tip, chain, crossings, disc_span, seat};
use crate::RegionalRoad;
use crate::graph::{EdgeClass, Key, NodeKind};
use crate::journal::Stage;

/// Stage the founding roads in source order so each piece sees earlier junctions.
/// Returns the number of road pieces refused by the graph.
pub fn import_regional_roads(
    stage: &mut Stage,
    event: &Key,
    roads: &[RegionalRoad],
    centre: Point,
    reach: f64,
    width: f64,
) -> usize {
    let mut next_rank = 0;
    let mut dropped = 0;
    for road in roads {
        if road.points.len() != road.stations.len() {
            dropped += 1;
            continue;
        }
        for mut piece in clip(road, centre, reach) {
            let length: f64 = piece.points.windows(2).map(|w| w[0].distance(w[1])).sum();
            if length < 4.0 * chain::MIN_GAP {
                continue;
            }
            let last = piece.points.len() - 1;
            let (start, a) = seat(stage.graph(), piece.points[0], NodeKind::StreetEnd);
            let (end, b) = seat(stage.graph(), piece.points[last], NodeKind::StreetEnd);
            piece.points[0] = a;
            piece.points[last] = b;
            let clear = [!matches!(start, Tip::Free(_)), !matches!(end, Tip::Free(_))];
            let Some(hits) = crossings(stage.graph(), &piece.points, clear, false) else {
                dropped += 1;
                continue;
            };
            let draw = Draw {
                event,
                next_rank: &mut next_rank,
                chain: None,
                class: EdgeClass::RegionalRoad,
                rank: road.rank,
                width,
            };
            let (ops, _) = chain::chain_ops_with_source(
                draw,
                &piece.points,
                start,
                end,
                &hits,
                Some((&road.id, &piece.stations)),
            );
            if stage.try_push(ops).is_err() {
                dropped += 1;
            }
        }
    }
    dropped
}

#[derive(Default)]
struct Piece {
    points: Vec<Point>,
    stations: Vec<f64>,
}

impl Piece {
    fn push(&mut self, point: Point, station: f64) {
        if self
            .points
            .last()
            .is_none_or(|last| last.distance(point) >= 1e-9)
        {
            self.points.push(point);
            self.stations.push(station);
        }
    }

    fn finish(&mut self, output: &mut Vec<Self>) {
        if self.points.len() > 1 {
            output.push(std::mem::take(self));
        } else {
            self.points.clear();
            self.stations.clear();
        }
    }
}

fn clip(road: &RegionalRoad, centre: Point, reach: f64) -> Vec<Piece> {
    let mut output = Vec::new();
    let mut piece = Piece::default();
    for (points, stations) in road.points.windows(2).zip(road.stations.windows(2)) {
        let [a, b] = [points[0], points[1]];
        let (from, to) = disc_span(a, b, centre, reach);
        if from > to {
            piece.finish(&mut output);
            continue;
        }
        if from > 0.0 {
            piece.finish(&mut output);
        }
        for t in [from, to] {
            let point = Point {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            };
            let station = stations[0] + (stations[1] - stations[0]) * t;
            piece.push(point, station);
        }
        if to < 1.0 {
            piece.finish(&mut output);
        }
    }
    piece.finish(&mut output);
    output
}
