//! Smooth occupation pressure on the retained pedestrian network. No street,
//! reserve or wall is created or moved by this calculation.
use super::*;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub(super) fn for_layout(layout: &Layout) -> Vec<f64> {
    let mut nodes = Vec::<Point>::new();
    let mut ids = BTreeMap::new();
    let mut graph = Vec::<Vec<(usize, f64)>>::new();
    let mut paths = Vec::new();
    let mut stations = Vec::new();
    for street in &layout.streets {
        let mut path = Vec::new();
        for &p in &street.path {
            let key = ((p.x * 1000.0).round() as i64, (p.y * 1000.0).round() as i64);
            let id = *ids.entry(key).or_insert_with(|| {
                let id = nodes.len();
                nodes.push(p);
                graph.push(Vec::new());
                id
            });
            path.push(id);
        }
        if !matches!(street.role.as_str(), "boundary" | "bridge") {
            for pair in path.windows(2) {
                let cost = length(sub(nodes[pair[0]], nodes[pair[1]]))
                    * if street.rank >= 3 { 1.15 } else { 1.0 };
                graph[pair[0]].push((pair[1], cost));
                graph[pair[1]].push((pair[0], cost));
            }
        }
        paths.push(path);
        // Same ascending additions as path[..=k].windows(2).sum(), once per
        // street instead of once per contact and segment (quadratic in a long
        // sampled street). Reusing the prefix does not reorder arithmetic.
        let mut prefix = vec![0.0];
        for pair in street.path.windows(2) {
            prefix.push(prefix.last().copied().unwrap() + length(sub(pair[1], pair[0])));
        }
        stations.push(prefix);
    }
    if nodes.is_empty() {
        return vec![0.0; layout.blocks.len()];
    }
    let mut distances = vec![f64::INFINITY; nodes.len()];
    let mut heap = BinaryHeap::new();
    let centers = layout
        .structure
        .as_ref()
        .map(|s| s.centers.iter().map(|c| c.point).collect::<Vec<_>>())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| vec![layout.center]);
    let mut sources = Vec::new();
    for center in centers {
        let mut closest = None;
        for (si, street) in layout.streets.iter().enumerate() {
            if matches!(street.role.as_str(), "boundary" | "bridge") {
                continue;
            }
            for (k, segment) in street.path.windows(2).enumerate() {
                let d = sub(segment[1], segment[0]);
                let len = length(d);
                if len < 1e-7 {
                    continue;
                }
                let t = (dot(sub(center, segment[0]), d) / (len * len)).clamp(0.0, 1.0);
                let cost = length(sub(center, add(segment[0], scale_point(d, t))));
                if closest.is_none_or(|(old, _, _, _, _)| cost < old) {
                    closest = Some((cost, si, k, t, len));
                }
            }
        }
        if let Some((cost, si, k, t, len)) = closest {
            let before = stations[si][k];
            sources.push((si, before + len * t, cost));
            let factor = if layout.streets[si].rank >= 3 {
                1.15
            } else {
                1.0
            };
            for (id, along) in [(paths[si][k], len * t), (paths[si][k + 1], len * (1.0 - t))] {
                let value = cost + along * factor;
                if value < distances[id] {
                    distances[id] = value;
                    heap.push(Reverse((value.to_bits(), id)));
                }
            }
        }
    }
    while let Some(Reverse((bits, id))) = heap.pop() {
        let cost = f64::from_bits(bits);
        if cost > distances[id] {
            continue;
        }
        for &(other, length) in &graph[id] {
            let next = cost + length;
            if next < distances[other] {
                distances[other] = next;
                heap.push(Reverse((next.to_bits(), other)));
            }
        }
    }
    let area = layout.blocks.iter().map(|b| area(&b.shape)).sum::<f64>();
    let scale = (area / std::f64::consts::PI).sqrt().clamp(60.0, 600.0);
    let index = FrontageIndex::new(layout);
    layout
        .blocks
        .iter()
        .map(|block| {
            let fronts = frontages(&block.shape, layout, &index);
            let mut access = f64::INFINITY;
            for f in &fronts {
                let midpoint = scale_point(add(f.a, f.b), 0.5);
                for (k, segment) in layout.streets[f.street].path.windows(2).enumerate() {
                    let direction = sub(segment[1], segment[0]);
                    let len = length(direction);
                    if len < 1e-7 {
                        continue;
                    }
                    let along = dot(sub(midpoint, segment[0]), direction) / len;
                    let at = along.clamp(0.0, len);
                    let lateral = length(sub(
                        midpoint,
                        add(segment[0], scale_point(direction, at / len)),
                    ));
                    let ids = &paths[f.street];
                    let factor = if layout.streets[f.street].rank >= 3 {
                        1.15
                    } else {
                        1.0
                    };
                    let before = stations[f.street][k];
                    let direct = sources
                        .iter()
                        .filter(|&&(si, _, _)| si == f.street)
                        .map(|&(_, source, cost)| cost + (before + at - source).abs() * factor)
                        .fold(f64::INFINITY, f64::min);
                    let route = (distances[ids[k]] + at * factor)
                        .min(distances[ids[k + 1]] + (len - at) * factor)
                        .min(direct)
                        + lateral;
                    access = access.min(route);
                }
            }
            if !access.is_finite() {
                0.0
            } else {
                (0.12 + 0.88 * (-access / scale).exp()).clamp(0.0, 1.0)
            }
        })
        .collect()
}

// Keep the metric normalizer distinct from the parent's vector scale helper.
fn scale_point(p: Point, s: f64) -> Point {
    super::scale(p, s)
}

pub(super) fn apply(
    morph: &Morph,
    pressure: f64,
    planned: bool,
    admission: Option<&super::super::culture::UrbanAdmissibility>,
) -> Morph {
    let mut result = morph.clone();
    let variation = if planned { 0.22 } else { 1.0 };
    let adjust = |value: f64, lo: f64, hi: f64, local_pressure: f64| {
        value * (1.0 + variation * (lo + (hi - lo) * local_pressure - 1.0))
    };
    for (key, lo, hi) in [
        ("frontage", 1.35, 0.88),
        ("plotDepth", 1.0, 0.9),
        ("houseArea", 1.25, 0.95),
        ("coverage", 0.62, 1.03),
    ] {
        let center = morph.range(key, "core");
        let edge = morph.range(key, "edge");
        if let Some(zones) = result.value[key].as_object_mut() {
            for (zone, range) in zones.iter_mut() {
                // Access modulates an applied growth phase. A distant but fully
                // urban core must not turn into edge gardens merely because the
                // pedestrian normalizer is capped at 600 m in a metropolis.
                let local_pressure = match zone.as_str() {
                    "core" => 0.65 + 0.35 * pressure,
                    "middle" => 0.35 + 0.65 * pressure,
                    _ => pressure,
                };
                if let Some(values) = range.as_array_mut() {
                    for (i, value) in values.iter_mut().enumerate() {
                        let original = value.as_f64().unwrap_or(1.0);
                        let base = if !planned
                            && zone != "village"
                            && i < 2
                            && center[i] > 0.0
                            && edge[i] > 0.0
                        {
                            edge[i] + (center[i] - edge[i]) * local_pressure
                        } else {
                            original
                        };
                        let mut number = adjust(base, lo, hi, local_pressure);
                        if let Some(a) = admission {
                            number = number.max(match key {
                                "frontage" => a.min_frontage * 1.15,
                                "plotDepth" => a.min_depth,
                                "houseArea" => a.min_area,
                                _ => 0.0,
                            });
                        }
                        if key == "coverage" {
                            number = number.clamp(0.05, 1.0);
                        }
                        *value = serde_json::json!(number);
                    }
                }
            }
        }
    }
    result.value["_occupationPressure"] = serde_json::json!(pressure);
    result
}

/// One pressure-adjusted range, with the same arithmetic as `apply` (without
/// admission floors), for consumers that need a few keys and not a cloned morph.
pub(super) fn adjusted(
    morph: &Morph,
    key: &str,
    zone: &str,
    pressure: f64,
    planned: bool,
    lo: f64,
    hi: f64,
) -> [f64; 2] {
    let variation = if planned { 0.22 } else { 1.0 };
    let local_pressure = match zone {
        "core" => 0.65 + 0.35 * pressure,
        "middle" => 0.35 + 0.65 * pressure,
        _ => pressure,
    };
    let center = morph.range(key, "core");
    let edge = morph.range(key, "edge");
    let original = morph.range(key, zone);
    let mut out = [0.0; 2];
    for i in 0..2 {
        let base = if !planned && zone != "village" && center[i] > 0.0 && edge[i] > 0.0 {
            edge[i] + (center[i] - edge[i]) * local_pressure
        } else {
            original[i]
        };
        out[i] = base * (1.0 + variation * (lo + (hi - lo) * local_pressure - 1.0));
    }
    out
}
