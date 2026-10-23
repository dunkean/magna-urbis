//! A small set of cadastral operations; streets and structural block boundaries
//! are immutable inputs. Shared courts are parcel land, never hidden new roads.
use super::*;

pub(super) fn family(op: &str) -> &'static str {
    match op {
        "compact" => "compact",
        "courtyard" | "compound" | "siheyuan" | "wholeBlock" => "courtyard",
        "inherited" => "inherited",
        _ => "frontage",
    }
}

/// Exact convex-rectangle containment, holes included: no boundary edge enters
/// the rectangle shrunk by 0.1 mm, and its centre lies inside. This replaces the
/// former boolean-difference witness (same verdict to numerical tolerance) at a
/// small fraction of its cost: one Liang-Barsky clip per boundary edge.
pub(super) fn rect_within(
    shape: &Shape,
    a: Point,
    u: Point,
    v: Point,
    width: f64,
    depth: f64,
) -> bool {
    const EPS: f64 = 1e-4;
    let (s0, s1, t0, t1) = (EPS, width - EPS, EPS, depth - EPS);
    if s1 <= s0 || t1 <= t0 {
        return false;
    }
    let local = |p: Point| {
        let d = sub(p, a);
        (dot(d, u), dot(d, v))
    };
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        for (&p, &q) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let ((px, py), (qx, qy)) = (local(p), local(q));
            if px.max(qx) <= s0 || px.min(qx) >= s1 || py.max(qy) <= t0 || py.min(qy) >= t1 {
                continue;
            }
            let (dx, dy) = (qx - px, qy - py);
            let (mut enter, mut exit) = (0.0_f64, 1.0_f64);
            let mut inside = true;
            for (pk, qk) in [(-dx, px - s0), (dx, s1 - px), (-dy, py - t0), (dy, t1 - py)] {
                if pk.abs() < 1e-15 {
                    if qk < 0.0 {
                        inside = false;
                        break;
                    }
                } else if pk < 0.0 {
                    enter = enter.max(qk / pk);
                } else {
                    exit = exit.min(qk / pk);
                }
            }
            if inside && enter <= exit {
                return false;
            }
        }
    }
    super::super::geometry::contains(
        shape,
        add(a, add(scale(u, width * 0.5), scale(v, depth * 0.5))),
    )
}

/// A bounded admissibility witness, checked by exact rectangle containment
/// (including holes). Failed search is a refusal, not proof that no plan exists.
pub(super) fn envelope(
    shape: &Shape,
    fronts: &[Front],
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    let contacts = contacts::boundary_contacts(shape, fronts);
    let mut candidates: Vec<_> = contacts
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let (lo, hi) = contacts::support_span(&contacts, i);
            (*f, lo, hi)
        })
        .filter(|(f, lo, hi)| hi - lo + 1e-6 >= if f.gate { access_width } else { width })
        .collect();
    // Bound useful candidates, rather than hiding the only long frontage
    // behind twelve short curved pieces in input vertex order.
    candidates.sort_by(|a, b| {
        (b.2 - b.1)
            .total_cmp(&(a.2 - a.1))
            .then(a.0.rank.cmp(&b.0.rank))
            .then(a.0.a.x.total_cmp(&b.0.a.x))
            .then(a.0.a.y.total_cmp(&b.0.a.y))
    });
    for (f, lo, hi) in candidates.into_iter().take(12) {
        let u = unit(sub(f.b, f.a));
        let v = normal(u);
        let len = hi - lo;
        // Do not search from a frontage too short for the admissible entry.
        if len + 1e-6 < if f.gate { access_width } else { width } {
            continue;
        }
        for t in [0.5, 0.25, 0.75, 0.0, 1.0] {
            let along = lo + (len - width) * t;
            for setback in [0.0, 0.5, 1.5, 3.0] {
                let a = add(add(f.a, scale(u, along)), scale(v, setback));
                if rect_within(shape, a, u, v, width, depth) {
                    return Some(rect(a, u, v, width, depth));
                }
            }
        }
        if f.gate {
            let (u0, u1) = bounds(shape, u);
            let (v0, v1) = bounds(shape, v);
            if u1 - u0 + 1e-6 >= width && v1 - v0 + 1e-6 >= depth {
                for along in [0.5, 0.25, 0.75, 0.0, 1.0] {
                    for across in [0.0, 0.25, 0.5, 0.75, 1.0] {
                        let a = add(
                            scale(u, u0 + (u1 - u0 - width) * along),
                            scale(v, v0 + (v1 - v0 - depth) * across),
                        );
                        if rect_within(shape, a, u, v, width, depth) {
                            return Some(rect(a, u, v, width, depth));
                        }
                    }
                }
            }
        }
    }
    None
}

fn rect(a: Point, u: Point, v: Point, width: f64, depth: f64) -> Shape {
    Shape {
        outer: vec![
            a,
            add(a, scale(u, width)),
            add(add(a, scale(u, width)), scale(v, depth)),
            add(a, scale(v, depth)),
        ],
        holes: Vec::new(),
    }
}

/// Retain a connected court/passage and cut compact properties around it. Its
/// internal boundary supplies collective contacts all tied to the real street.
pub(super) fn courts(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &mut Vec<Front>,
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    if morph.range("houseArea", zone)[0] > area(shape) * 0.5 {
        return courtyards(shape, block, axis, fronts, morph, zone, rng);
    }
    let Some(f) = fronts
        .iter()
        .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))))
        .copied()
    else {
        return Vec::new();
    };
    let width = morph.range("frontage", zone)[0].clamp(2.4, 4.0);
    let u = unit(sub(f.b, f.a));
    let v = normal(u);
    let mid = scale(add(f.a, f.b), 0.5);
    let cap = ray_limit(shape, add(mid, scale(v, 0.05)), v, fronts, f.rank);
    let depth = morph.range("plotDepth", zone)[0].max(8.0).min(cap * 0.6);
    let court_size = morph.range("houseArea", zone)[0].sqrt().clamp(6.0, 16.0);
    // Small domains remain one enclos rather than being hollowed into slivers.
    if !depth.is_finite() || depth < court_size || length(sub(f.b, f.a)) < court_size * 2.0 {
        return courtyards(shape, block, axis, fronts, morph, zone, rng);
    }
    let rect = |lo: f64, hi: f64, near: f64, far: f64| Shape {
        outer: vec![
            add(add(mid, scale(u, lo)), scale(v, near)),
            add(add(mid, scale(u, hi)), scale(v, near)),
            add(add(mid, scale(u, hi)), scale(v, far)),
            add(add(mid, scale(u, lo)), scale(v, far)),
        ],
        holes: Vec::new(),
    };
    // The complete minimum-width access spine must fit, including every hole.
    // Connected clipped area alone could otherwise conceal a narrow pinch.
    {
        use geo::{Area, BooleanOps};
        let spine = rect(-width * 0.5, width * 0.5, 0.0, depth);
        let outside = super::super::geometry::polygon(&spine)
            .difference(&super::super::geometry::polygon(shape))
            .unsigned_area();
        if outside > 1e-5 {
            return courtyards(shape, block, axis, fronts, morph, zone, rng);
        }
    }
    let passage = rect(-width * 0.5, width * 0.5, -0.05, depth + court_size * 0.5);
    let square = rect(
        -court_size * 0.5,
        court_size * 0.5,
        depth - court_size * 0.5,
        depth + court_size * 0.5,
    );
    let shared = super::super::geometry::union(&[passage, square]);
    let shared: Vec<_> = shared.iter().flat_map(|s| intersection(s, shape)).collect();
    if shared.len() != 1 || frontage(&shared[0], fronts).0 < width * 0.9 {
        return courtyards(shape, block, axis, fronts, morph, zone, rng);
    }
    let court = &shared[0];
    // A clipped/disconnected branch cannot acquire fictional access.
    for ring in std::iter::once(&court.outer).chain(court.holes.iter()) {
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            fronts.push(Front {
                a: b,
                b: a,
                street: f.street,
                rank: f.rank,
                shared: true,
                gate: true,
            });
        }
    }
    let mut result = Vec::new();
    for (i, cell) in difference(shape, court).into_iter().enumerate() {
        result.extend(courtyards(
            &cell,
            block,
            axis,
            fronts,
            morph,
            zone,
            &mut rng.fork(&format!("court-domain:{i}")),
        ));
    }
    let mut parcel = parcel(court.clone(), block, axis, fronts, "court");
    parcel.use_kind = "court".into();
    parcel.reason = "shared-court-and-passage".into();
    parcel.provenance = vec!["shared-access-reservation".into()];
    result.push(parcel);
    result
}

/// Older frontage domains survive as explicit ancestors. Only bounded local
/// subdivision/fusion occurs; a structural street or block edge is never moved.
pub(super) fn inherited(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let mut ancestral = morph.clone();
    if let Some(ranges) = ancestral.value["frontage"].as_object_mut() {
        for range in ranges.values_mut() {
            if let Some(values) = range.as_array_mut() {
                for value in values {
                    *value = serde_json::json!(value.as_f64().unwrap_or(8.0) * 1.8);
                }
            }
        }
    }
    let parents = frontage_territories(
        shape,
        block,
        axis,
        fronts,
        &ancestral,
        zone,
        &mut rng.fork("ancestral-domains"),
    );
    let mut result = Vec::new();
    for (i, parent) in parents.into_iter().enumerate() {
        let pressure = morph.value["_occupationPressure"].as_f64().unwrap_or(0.55);
        let divide = rng
            .fork(&format!(
                "inheritance-pressure:{}",
                parent
                    .id
                    .split_once('/')
                    .map_or(parent.id.as_str(), |(_, hash)| hash)
            ))
            .float()
            < 0.2 + 0.75 * pressure;
        if parent.use_kind != "plot" || !divide {
            let mut parent = parent;
            parent.provenance.push("inherited-domain-retained".into());
            result.push(parent);
            continue;
        }
        let mut children = strips(
            &parent.shape,
            block,
            axis,
            fronts,
            morph,
            zone,
            &mut rng.fork(&format!("inheritance:{i}")),
        );
        if children.iter().filter(|p| p.use_kind == "plot").count() < 2 {
            result.push(parent);
            continue;
        }
        // Every fourth divided domain consolidates its nearest pair, preserving
        // their former IDs instead of adding noisy boundary vertices.
        if i % 4 == 0 && children.len() > 2 {
            let candidate = (1..children.len())
                .find(|&j| shared(&children[0].shape, &children[j].shape) > 0.05);
            if let Some(j) = candidate
                && let Some(shape) = joined(&children[0].shape, &children[j].shape)
            {
                let mut merged = parcel(shape, block, axis, fronts, "plot");
                merged.parent_ids = vec![children[0].id.clone(), children[j].id.clone()];
                merged.provenance = vec!["inheritance-consolidation".into()];
                children[0] = merged;
                children.remove(j);
            }
        }
        for child in &mut children {
            if child
                .parent_ids
                .iter()
                .all(|id| id.starts_with("block-") && !id.contains('/'))
            {
                child.parent_ids = vec![parent.id.clone()];
            }
            child.provenance.insert(0, "inherited-subdivision".into());
        }
        result.extend(children);
    }
    result
}

/// Inward courtyard tissue (medina derbs, hutong branches, Byzantine closes).
/// Lots are sized from the culture's house areas and cut along streets; every
/// part of the block farther than one lot band from any access receives a
/// cul-de-sac passage (1.4-2.4 m) ending in a small square. Each passage starts
/// from the nearest street or earlier passage, so they form trees that always
/// reach a street; lots along them are entered through a gate. Passages are
/// shared parcel land (`court`), never new public streets.
pub(super) fn derbs(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &mut Vec<Front>,
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    use super::super::geometry::{ContainmentIndex, bbox, union};
    let [amin, amax] = morph.range("houseArea", zone);
    let (amin, amax) = (amin.max(40.0), amax.max(amin.max(40.0)));
    let [f0, f1] = morph.range("frontage", zone);
    let [d0, d1] = morph.range("plotDepth", zone);
    let width = [f0.max(0.75 * amin.sqrt()).max(4.0), 0.0];
    let width = [width[0], f1.max(0.9 * amax.sqrt()).max(width[0])];
    let cap = maximum_plot_depth(morph, zone);
    let depth = [
        d0.max(amin.sqrt()).min(cap),
        d1.max(1.2 * amax.sqrt()).min(cap),
    ];
    let mut lots = morph.clone();
    lots.value["frontage"][zone] = serde_json::json!(width);
    lots.value["plotDepth"][zone] = serde_json::json!(depth);
    lots.value["deepFill"] = serde_json::json!(true);
    let reach = depth[1];
    let total = area(shape);
    // Far samples of the block (a coarse grid, at most ~600 points).
    let (x0, y0, x1, y1) = bbox(shape);
    let step = (reach / 3.0).max((total / 600.0).sqrt()).max(2.0);
    let inside = ContainmentIndex::new(shape);
    let mut samples = Vec::new();
    let mut y = y0 + step * 0.5;
    while total > 1.5 * reach * reach && y < y1 {
        let mut x = x0 + step * 0.5;
        while x < x1 {
            let p = Point { x, y };
            if inside.contains(p) {
                samples.push(p);
            }
            x += step;
        }
        y += step;
    }
    let near = |p: Point, a: Point, b: Point| distance(p, a, b);
    let mut far: Vec<f64> = samples
        .iter()
        .map(|&p| {
            fronts
                .iter()
                .filter(|f| !f.shared)
                .map(|f| near(p, f.a, f.b))
                .fold(f64::INFINITY, f64::min)
        })
        .collect();
    // Access lines: streets first, then each carved passage centre line.
    let mut lines: Vec<(Point, Point, Front)> = fronts
        .iter()
        .filter(|f| !f.shared)
        .map(|f| (f.a, f.b, *f))
        .collect();
    let lane = {
        let pair = morph.pair("derbWidth");
        if pair[1] > 0.0 { pair } else { [1.4, 2.4] }
    };
    let mut pieces: Vec<(Shape, Front)> = Vec::new();
    for _ in 0..24 {
        if pieces.len() >= 10 || lines.is_empty() {
            break;
        }
        let Some((i, &d)) = far
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1).then(b.0.cmp(&a.0)))
        else {
            break;
        };
        if d <= reach * 1.15 {
            break;
        }
        let p = samples[i];
        let (q, f) = lines
            .iter()
            .map(|&(a, b, f)| {
                let e = sub(b, a);
                let t = (dot(sub(p, a), e) / dot(e, e).max(1e-12)).clamp(0.0, 1.0);
                (add(a, scale(e, t)), f)
            })
            .min_by(|a, b| length(sub(p, a.0)).total_cmp(&length(sub(p, b.0))))
            .unwrap();
        // Stop one lot band short of the far side: that band is served too.
        let len = (length(sub(p, q)) - 0.5 * reach).max(0.0);
        let dir = unit(sub(p, q));
        let n = normal(dir);
        let w = rng.range(lane[0], lane[1]);
        let end = add(q, scale(dir, len));
        let square = (2.5 * w).clamp(4.0, 7.0);
        let fits = len > 6.0
            && rect_within(
                shape,
                add(add(q, scale(dir, 0.6)), scale(n, -0.5 * w)),
                dir,
                n,
                len - 0.6,
                w,
            )
            && rect_within(
                shape,
                add(add(end, scale(dir, -0.5 * square)), scale(n, -0.5 * square)),
                dir,
                n,
                square,
                square,
            );
        if !fits {
            far[i] = 0.0;
            continue;
        }
        let start = add(q, scale(dir, -0.5));
        pieces.push((
            rect(add(start, scale(n, -0.5 * w)), dir, n, len + 0.5, w),
            f,
        ));
        pieces.push((
            rect(
                add(add(end, scale(dir, -0.5 * square)), scale(n, -0.5 * square)),
                dir,
                n,
                square,
                square,
            ),
            f,
        ));
        lines.push((q, end, f));
        for (k, s) in samples.iter().enumerate() {
            far[k] = far[k].min(near(*s, q, end) - 0.5 * w);
        }
    }
    if pieces.is_empty() {
        return strips(shape, block, axis, fronts, &lots, zone, rng);
    }
    let courts: Vec<(Shape, Front)> =
        union(&pieces.iter().map(|p| p.0.clone()).collect::<Vec<_>>())
            .iter()
            .flat_map(|s| intersection(s, shape))
            .map(|c| {
                let f = pieces
                    .iter()
                    .find(|(p, _)| !intersection(p, &c).is_empty())
                    .map_or(pieces[0].1, |p| p.1);
                (c, f)
            })
            .collect();
    let mut cells = vec![shape.clone()];
    for (court, f) in &courts {
        cells = cells.iter().flat_map(|c| difference(c, court)).collect();
        // Reversed court rings: their left side faces the lots around them.
        for ring in std::iter::once(&court.outer).chain(court.holes.iter()) {
            for (&a, &b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                fronts.push(Front {
                    a: b,
                    b: a,
                    street: f.street,
                    rank: f.rank + 1,
                    shared: true,
                    gate: true,
                });
            }
        }
    }
    let mut result = Vec::new();
    for (i, cell) in cells.iter().enumerate() {
        result.extend(strips(
            cell,
            block,
            axis,
            fronts,
            &lots,
            zone,
            &mut rng.fork(&format!("derb-domain:{i}")),
        ));
    }
    for (court, _) in courts {
        let mut p = parcel(court, block, axis, fronts, "court");
        p.use_kind = "court".into();
        p.reason = "shared-court-and-passage".into();
        p.provenance = vec!["derb-passage".into()];
        result.push(p);
    }
    result
}
