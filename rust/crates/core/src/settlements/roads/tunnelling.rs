//! Road tunnels dug through Underdark cave rock.
//!
//! On an Underdark map (`Fields::cave`), a road of a culture that digs (`tunnelling.json`) may cross
//! cave rock when the way round through the caves is much longer: the search gets single-step moves
//! into the rock at the culture's cost per metre, with no grade inside the rock (a dug floor is laid
//! at its own grade) and dearer turns (surveyed straight reaches). The bounds are checked on the
//! found path: each dug stretch has two mouths on open floor, is at most `maxLength` long and climbs
//! at most `maxGrade` between its mouths, and the map's budget of dug tunnels is not exceeded;
//! otherwise the route is searched again without digging. Cave rock is not a crossing: a dug stretch
//! is reported as a segment tunnel, never as a bridge or causeway.

use super::super::Point;
use super::super::grid::Fields;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// A stretch of road dug through cave rock: the path from the open floor before it to the open
/// floor after it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tunnel {
    /// `dug` (natural tunnels are terrain, not roads).
    pub kind: String,
    pub path: Vec<Point>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    cost: BTreeMap<String, f64>,
    max_length: f64,
    max_grade: f64,
    per_map: f64,
}

fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("tunnelling.json")).expect("valid tunnelling.json"))
}

/// Cost of one metre dug for this culture, relative to open ground; 0 when it never digs.
pub(super) fn cost(culture: &str) -> f64 {
    data().cost.get(culture).copied().filter(|c| c.is_finite() && *c > 0.0).unwrap_or(0.0)
}

/// Cave rock a road may be dug through (Underdark maps only).
pub(super) fn rock(f: &Fields, i: usize) -> bool {
    f.cave.is_some() && f.is_rock(i)
}

/// Dug tunnels allowed on this map: `amount` × `perMap` × sqrt(width / 10 km); none off the Underdark.
pub(super) fn budget(f: &Fields, amount: f64) -> usize {
    if f.cave.is_none() || !amount.is_finite() || amount <= 0.0 {
        return 0;
    }
    let scale = (f.r.width / 10_000.0).sqrt().clamp(0.5, 3.0);
    (amount.min(3.0) * data().per_map * scale).round() as usize
}

/// New dug stretches of a routed cell path, as index ranges `(first, last)` of rock cells; `None`
/// when a stretch breaks a bound (no mouth on open floor, too long, too steep). Stretches whose
/// cells are all on the network already (an earlier tunnel) are reused, not counted.
pub(super) fn new_stretches(f: &Fields, cells: &[usize], on_network: &[bool]) -> Option<Vec<(usize, usize)>> {
    let d = data();
    let mut out = vec![];
    let mut k = 0;
    while k < cells.len() {
        if !rock(f, cells[k]) {
            k += 1;
            continue;
        }
        let first = k;
        while k + 1 < cells.len() && rock(f, cells[k + 1]) {
            k += 1;
        }
        let last = k;
        k += 1;
        if (first..=last).all(|j| on_network[cells[j]]) {
            continue;
        }
        if first == 0 || last + 1 >= cells.len() {
            return None;
        }
        let (a, b) = (cells[first - 1], cells[last + 1]);
        let length: f64 = cells[first - 1..=last + 1].windows(2).map(|w| f.pos(w[0]).distance(f.pos(w[1]))).sum();
        let rise = (f.route_height[a] - f.route_height[b]).abs() as f64;
        if length > d.max_length || rise > d.max_grade * length {
            return None;
        }
        out.push((first, last));
    }
    Some(out)
}

/// Dug stretches of a final road path: runs of samples (a quarter cell apart) in cave rock, each carried on
/// along the road to the first sample whose cell and its eight neighbours are open floor, so both mouths
/// stand on the floor even on a finer display raster. Empty off the Underdark.
pub(super) fn spans(f: &Fields, path: &[Point]) -> Vec<Tunnel> {
    let mut out = vec![];
    if f.cave.is_none() || path.len() < 2 {
        return out;
    }
    let mut samples = vec![path[0]];
    for seg in path.windows(2) {
        let len = seg[0].distance(seg[1]);
        let steps = (len / (f.cell * 0.25)).ceil().max(1.0) as usize;
        samples.extend((1..=steps).map(|s| {
            let t = s as f64 / steps as f64;
            Point { x: seg[0].x + (seg[1].x - seg[0].x) * t, y: seg[0].y + (seg[1].y - seg[0].y) * t }
        }));
    }
    let n = f.r.n;
    let in_rock: Vec<bool> = samples.iter().map(|&p| rock(f, f.index(p))).collect();
    let clear: Vec<bool> = samples
        .iter()
        .map(|&p| {
            let i = f.index(p);
            let (x, y) = (i % n, i / n);
            (y.saturating_sub(1)..=(y + 1).min(n - 1))
                .all(|yy| (x.saturating_sub(1)..=(x + 1).min(n - 1)).all(|xx| !rock(f, yy * n + xx)))
        })
        .collect();
    let mut k = 0;
    while k < samples.len() {
        if !in_rock[k] {
            k += 1;
            continue;
        }
        let mut first = k;
        while k + 1 < samples.len() && in_rock[k + 1] {
            k += 1;
        }
        let mut last = k;
        while first > 0 && !clear[first] {
            first -= 1;
        }
        while last + 1 < samples.len() && !clear[last] {
            last += 1;
        }
        if last > first {
            out.push(Tunnel { kind: "dug".into(), path: simplify(samples[first..=last].to_vec()) });
        }
        // The next stretch starts after this one's mouth.
        k = last + 1;
    }
    out
}

/// Drops the samples on a straight reach, keeping the ends and the bends (stations).
fn simplify(points: Vec<Point>) -> Vec<Point> {
    if points.len() < 3 {
        return points;
    }
    let mut out = vec![points[0]];
    for w in points.windows(3) {
        let (a, b, c) = (w[0], w[1], w[2]);
        let cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if cross.abs() > 1e-6 * (1.0 + a.distance(c)) {
            out.push(b);
        }
    }
    out.push(points[points.len() - 1]);
    out
}

#[cfg(test)]
mod tests {
    use super::super::{ExitCounts, RoadConfig, RoadSite, route};
    use super::*;
    use crate::settlements::Raster;

    /// A 64² Underdark map (50 m cells): a rock barrier x 29..35 (300 m), y 0..30 between two towns
    /// 1 km apart at y = 6; the way round passes under the barrier's end, inside the search window.
    /// Cave rock as the bridge marks it: class 2, level 1000 m below the ground.
    fn barrier() -> (Vec<f32>, Vec<u8>, Vec<f32>, Vec<f32>, Vec<i32>) {
        let n = 64;
        let h = vec![100.0f32; n * n];
        let rock = |x: usize, y: usize| ((29..35).contains(&x) && y < 30) || (x < 5 && y >= 56);
        let water: Vec<u8> = (0..n * n).map(|i| u8::from(rock(i % n, i / n)) * 2).collect();
        let level: Vec<f32> = (0..n * n).map(|i| if water[i] == 2 { h[i] - 1000.0 } else { h[i] }).collect();
        (h, water, level, vec![0.0; n * n], vec![-1; n * n])
    }

    fn roads(culture: &str) -> super::super::RoadOutput {
        let (h, water, level, rivers, ids) = barrier();
        let f = Fields::new(Raster { width: 3200.0, n: 64, height: &h, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids });
        assert!(f.cave.is_some(), "an Underdark raster");
        let town = |key: &str, x: f64| RoadSite { key: key.into(), population: 400, culture: culture.into(), center: Point { x, y: 325.0 }, radius: 60.0, ..Default::default() };
        let cfg = RoadConfig { density: 0.0, exits: ExitCounts::default(), ..Default::default() };
        route("dig", &f, &[town("west", 1125.0), town("east", 2125.0)], &cfg).unwrap()
    }

    #[test]
    fn a_digging_culture_tunnels_through_the_barrier() {
        let out = roads("duergar-hold");
        let tunnels: Vec<&Tunnel> = out.segments.iter().flat_map(|s| &s.tunnels).collect();
        assert_eq!(tunnels.len(), 1, "one dug tunnel");
        let t = tunnels[0];
        assert_eq!(t.kind, "dug");
        let length: f64 = t.path.windows(2).map(|w| w[0].distance(w[1])).sum();
        assert!((250.0..=data().max_length).contains(&length), "tunnel length {length}");
        // Not a crossing: no bridge or causeway over the rock.
        assert!(out.segments.iter().all(|s| s.crossings.is_empty()));
        assert!(out.unreachable.is_empty());
    }

    #[test]
    fn a_non_digging_culture_goes_round() {
        // Myconids never dig (drow dig only when the way round is very long: a culture choice, not tested here).
        for culture in ["myconid-colony"] {
            let out = roads(culture);
            assert!(out.segments.iter().all(|s| s.tunnels.is_empty()), "{culture} dug a tunnel");
            assert!(out.unreachable.is_empty(), "{culture} found no way round");
            // The way round passes below the barrier's end (y >= 1500 m).
            assert!(out.segments.iter().flat_map(|s| &s.path).any(|p| p.y >= 1450.0), "{culture} did not go round");
        }
    }

    #[test]
    fn bounds_and_budget() {
        let (h, water, level, rivers, ids) = barrier();
        let f = Fields::new(Raster { width: 3200.0, n: 64, height: &h, water: &water, water_level: &level, river_width: &rivers, river_ids: &ids });
        assert_eq!(budget(&f, 0.0), 0);
        assert!(budget(&f, 1.0) >= 1);
        let dry = vec![0u8; 64 * 64];
        let plain = Fields::new(Raster { width: 3200.0, n: 64, height: &h, water: &dry, water_level: &h, river_width: &rivers, river_ids: &ids });
        assert_eq!(budget(&plain, 1.0), 0, "no tunnels off the Underdark");
        assert_eq!(cost("myconid-colony"), 0.0);
        assert!(cost("duergar-hold") > 0.0 && cost("drow-enclave") > cost("duergar-hold"));
        // A straight row through the barrier: 6 rock cells (300 m) between two open mouths.
        let row: Vec<usize> = (20..44).map(|x| 10 * 64 + x).collect();
        let none = vec![false; 64 * 64];
        assert_eq!(new_stretches(&f, &row, &none), Some(vec![(9, 14)]));
        // Starting inside the rock: no mouth.
        assert_eq!(new_stretches(&f, &row[10..], &none), None);
    }
}
