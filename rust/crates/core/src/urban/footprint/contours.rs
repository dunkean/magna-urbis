//! Smooth vector contours extracted from the growth lattice and preserve exclusions.
use super::geometry::{area, distance, union};
use crate::urban::{Point, Shape, Surface, geometry as g};
use geo::{LineString, Simplify, Validation};

/// Remove the growth lattice's right-angle staircase without reconstructing a
/// shoreline. Water holes remain frozen and the result is re-clipped against the
/// original terrain mask. Every narrow-arm boundary cell retains its center.
/// Invalid or materially different candidates keep the exact original contour.
pub(super) fn smooth_growth(
    shapes: &[Shape],
    step: f64,
    surface: Surface<'_>,
    anchors: &[Point],
) -> Vec<Shape> {
    fn ring(points: &[Point], step: f64) -> Vec<Point> {
        // Collapse complete lattice steps before rounding. Rounding each raw
        // right angle alone preserves the staircase at every zoom level.
        let mut closed: Vec<_> = points
            .iter()
            .map(|p| geo::Coord { x: p.x, y: p.y })
            .collect();
        if let Some(p) = closed.first().copied() {
            closed.push(p);
        }
        let simplified = LineString(closed).simplify(step * 0.55);
        let mut outline: Vec<_> = simplified
            .0
            .into_iter()
            .map(|p| Point { x: p.x, y: p.y })
            .collect();
        outline.pop();
        if outline.len() < 3 {
            return points.to_vec();
        }
        // Sample by physical distance so long sides and dense raster corners
        // receive the same smoothing, without shrinking narrow branches.
        let mut points: Vec<_> = outline
            .iter()
            .zip(outline.iter().cycle().skip(1))
            .take(outline.len())
            .flat_map(|(&a, &b)| {
                let n = (distance(a, b) / step).ceil().max(1.0) as usize;
                (0..n).map(move |i| {
                    let t = i as f64 / n as f64;
                    Point {
                        x: a.x * (1.0 - t) + b.x * t,
                        y: a.y * (1.0 - t) + b.y * t,
                    }
                })
            })
            .collect();
        // Attenuate residual one-cell undulations over several cells before
        // fitting the corners. Keep displacement below half a cell so thin
        // arms retain their supporting cell centers.
        let sampled = points.clone();
        for _ in 0..3 {
            points = (0..points.len())
                .map(|i| {
                    let mut p = Point { x: 0.0, y: 0.0 };
                    for (j, weight) in [1.0, 4.0, 6.0, 4.0, 1.0].into_iter().enumerate() {
                        let q = points[(i + points.len() + j - 2) % points.len()];
                        p.x += q.x * weight / 16.0;
                        p.y += q.y * weight / 16.0;
                    }
                    let a = sampled[i];
                    let t = (step * 0.45 / distance(a, p).max(1.0e-9)).min(1.0);
                    Point {
                        x: a.x + (p.x - a.x) * t,
                        y: a.y + (p.y - a.y) * t,
                    }
                })
                .collect();
        }
        for _ in 0..3 {
            points = points
                .iter()
                .zip(points.iter().cycle().skip(1))
                .take(points.len())
                .flat_map(|(&a, &b)| {
                    let t = 0.25;
                    [
                        Point {
                            x: a.x * (1.0 - t) + b.x * t,
                            y: a.y * (1.0 - t) + b.y * t,
                        },
                        Point {
                            x: a.x * t + b.x * (1.0 - t),
                            y: a.y * t + b.y * (1.0 - t),
                        },
                    ]
                })
                .collect();
        }
        let mut closed: Vec<_> = points
            .iter()
            .map(|p| geo::Coord { x: p.x, y: p.y })
            .collect();
        if let Some(p) = closed.first().copied() {
            closed.push(p);
        }
        let simplified = LineString(closed).simplify(step * 0.025);
        let mut result: Vec<_> = simplified
            .0
            .into_iter()
            .map(|p| Point { x: p.x, y: p.y })
            .collect();
        if result.len() > 1 {
            result.pop();
        }
        result
    }
    // Open-space holes left by the lattice are smoothed like the outline; exact
    // water holes (clipped from vector geography) are never axis-aligned and stay.
    let lattice = |ring: &[Point]| {
        ring.iter()
            .zip(ring.iter().cycle().skip(1))
            .all(|(a, b)| (a.x - b.x).abs() < 1e-6 || (a.y - b.y).abs() < 1e-6)
    };
    // A smoothed corner that grazes a channel cuts off dry crumbs far below a
    // growth cell; they are not land of the town and must not veto the outline.
    let dry_main = |s: &Shape| -> Vec<Shape> {
        g::dry_clip(&surface, s)
            .into_iter()
            .filter(|p| g::area(p) >= (step * step).min(g::area(s)) * 0.25)
            .collect()
    };
    let mut candidates = vec![];
    for original in shapes {
        let outline = g::normalized(Shape {
            outer: ring(&original.outer, step),
            holes: original
                .holes
                .iter()
                .map(|h| if lattice(h) { ring(h, step) } else { h.clone() })
                .collect(),
        });
        if outline.outer.len() < 3 || !g::polygon(&outline).is_valid() {
            candidates.push(original.clone());
            continue;
        }
        let mut clipped = dry_main(&outline);
        if clipped.len() != 1
            || clipped[0].holes.len() != original.holes.len()
            || !g::polygon(&clipped[0]).is_valid()
        {
            candidates.push(original.clone());
            continue;
        }
        // Preserve an isolated boundary cell locally instead of restoring the
        // staircase of the entire district when one smoothing corner clips it.
        // Raster water holes are lattice rings too: their rounded corners can
        // swallow a cell centre and are pushed back the same way.
        let mut repaired = clipped[0].clone();
        let mut moved = false;
        for &p in anchors.iter().filter(|&&p| g::contains(original, p)) {
            if g::contains(&repaired, p) {
                continue;
            }
            let closest = std::iter::once(&repaired.outer)
                .chain(&repaired.holes)
                .enumerate()
                .flat_map(|(r, ring)| {
                    (0..ring.len()).map(move |i| {
                        let (d, t, q) = g::distance(p, ring[i], ring[(i + 1) % ring.len()]);
                        (r, i, d, t, q)
                    })
                })
                .min_by(|a, b| a.2.total_cmp(&b.2));
            let Some((r, i, d, t, q)) = closest else {
                continue;
            };
            // Simplification (0.55 cell) and rounding (0.45 cell) together can
            // pass a full cell inside a boundary centre; push back that far.
            if d <= 1.0e-9 || d > step {
                continue;
            }
            moved = true;
            let ring = if r == 0 {
                &mut repaired.outer
            } else {
                &mut repaired.holes[r - 1]
            };
            if t > 1.0e-6 && t < 1.0 - 1.0e-6 {
                ring.insert(i + 1, q);
            }
            let shift = (d + step * 0.02) / d;
            for v in ring.iter_mut() {
                let weight = (1.0 - distance(*v, q) / (step * 2.0)).max(0.0).powi(2);
                v.x += (p.x - q.x) * shift * weight;
                v.y += (p.y - q.y) * shift * weight;
            }
        }
        if moved && g::polygon(&repaired).is_valid() {
            let next = dry_main(&repaired);
            if next.len() == 1
                && next[0].holes.len() == original.holes.len()
                && g::polygon(&next[0]).is_valid()
            {
                clipped = next;
            }
        }
        // Rounding (and the anchor repair) can shift the area by a few percent
        // and restore the whole lattice contour. Recover it with a bounded
        // correction of the outer ring; water holes stay fixed and are clipped
        // again before the same topology, displacement and anchor checks.
        if (g::area(&clipped[0]) - g::area(original)).abs() > g::area(original) * 0.005 {
            // Uniform offset of the outer ring along its normals by the area
            // difference over the perimeter (smoothed open-space holes also
            // change the area, which a scale about the centre cannot absorb).
            let ring = &clipped[0].outer;
            let length: f64 = ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .map(|(&a, &b)| distance(a, b))
                .sum();
            let offset = (g::area(original) - g::area(&clipped[0])) / length.max(1e-9);
            let sign = g::signed(ring).signum();
            let normal = |a: Point, b: Point| {
                let l = distance(a, b).max(1e-9);
                Point {
                    x: sign * (b.y - a.y) / l,
                    y: -sign * (b.x - a.x) / l,
                }
            };
            let n = ring.len();
            let mut adjusted = clipped[0].clone();
            for i in 0..n {
                let (a, b) = (
                    normal(ring[(i + n - 1) % n], ring[i]),
                    normal(ring[i], ring[(i + 1) % n]),
                );
                let (mx, my) = (a.x + b.x, a.y + b.y);
                let m = mx.hypot(my).max(1e-9);
                // Miter length 1/cos(half angle), capped on sharp corners.
                let miter = (2.0 / m).min(2.0);
                adjusted.outer[i].x += mx / m * offset * miter;
                adjusted.outer[i].y += my / m * offset * miter;
            }
            if offset.abs() <= step * 0.45 && g::polygon(&adjusted).is_valid() {
                let next = dry_main(&adjusted);
                if next.len() == 1
                    && next[0].holes.len() == original.holes.len()
                    && g::polygon(&next[0]).is_valid()
                    && anchors
                        .iter()
                        .filter(|&&p| g::contains(original, p) && g::contains(&clipped[0], p))
                        .all(|&p| g::contains(&next[0], p))
                {
                    clipped = next;
                }
            }
        }
        let candidate = &clipped[0];
        let original_area = g::area(original);
        let changed_area =
            area(&g::difference(original, candidate)) + area(&g::difference(candidate, original));
        let protected = anchors
            .iter()
            .copied()
            .filter(|&p| g::contains(original, p));
        // Boundary displacement scales with perimeter and grid spacing, not
        // just total area. An area cap (1%, then 8%) rejected valid smoothing of
        // small or elongated districts (two-cell faubourg arms move a fifth of
        // their area) and restored their whole staircase; boundary cell centres
        // and the net area bound below already protect the land.
        let perimeter: f64 = std::iter::once(&original.outer)
            .chain(&original.holes)
            .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
            .map(|(&a, &b)| distance(a, b))
            .sum();
        let accepted = changed_area <= perimeter * step * 0.6 + 0.001
            && (g::area(candidate) - original_area).abs() <= original_area * 0.02 + 0.001
            && g::contains(candidate, g::interior_point(original))
            && protected.into_iter().all(|p| g::contains(candidate, p));
        candidates.push(if accepted {
            candidate.clone()
        } else {
            original.clone()
        });
    }
    let original_holes: usize = shapes.iter().map(|s| s.holes.len()).sum();
    let topology = |candidates: &[Shape]| {
        let merged = union(candidates);
        let merged_holes: usize = merged.iter().map(|s| s.holes.len()).sum();
        (merged.len() == shapes.len()
            && merged_holes == original_holes
            && geo::MultiPolygon(merged.iter().map(g::polygon).collect()).is_valid())
        .then_some(merged)
    };
    if let Some(merged) = topology(&candidates) {
        return merged;
    }
    // Two smoothed neighbours that now touch revert alone, not the whole town:
    // a global revert restored the staircase on every district.
    let boxes: Vec<_> = candidates.iter().map(g::bbox).collect();
    for i in 0..candidates.len() {
        let touches = (0..candidates.len()).any(|j| {
            j != i
                && boxes[i].0 <= boxes[j].2
                && boxes[j].0 <= boxes[i].2
                && boxes[i].1 <= boxes[j].3
                && boxes[j].1 <= boxes[i].3
                && !g::intersection(&candidates[i], &candidates[j]).is_empty()
        });
        if touches {
            candidates[i] = shapes[i].clone();
        }
    }
    topology(&candidates).unwrap_or_else(|| shapes.to_vec())
}
