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

/// A bounded admissibility witness, checked by polygon difference (including
/// holes). Failed search is a refusal, not proof that no possible plan exists.
pub(super) fn envelope(
    shape: &Shape,
    fronts: &[Front],
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    use geo::{Area, BooleanOps};
    let polygon = super::super::geometry::polygon(shape);
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
                let candidate = Shape {
                    outer: vec![
                        a,
                        add(a, scale(u, width)),
                        add(add(a, scale(u, width)), scale(v, depth)),
                        add(a, scale(v, depth)),
                    ],
                    holes: Vec::new(),
                };
                let outside = super::super::geometry::polygon(&candidate)
                    .difference(&polygon)
                    .unsigned_area();
                if outside < 1e-5_f64.max(width * depth * 1e-8) {
                    return Some(candidate);
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
                        let candidate = Shape {
                            outer: vec![
                                a,
                                add(a, scale(u, width)),
                                add(add(a, scale(u, width)), scale(v, depth)),
                                add(a, scale(v, depth)),
                            ],
                            holes: Vec::new(),
                        };
                        if super::super::geometry::polygon(&candidate)
                            .difference(&polygon)
                            .unsigned_area()
                            < 1e-5_f64.max(width * depth * 1e-8)
                        {
                            return Some(candidate);
                        }
                    }
                }
            }
        }
    }
    None
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
